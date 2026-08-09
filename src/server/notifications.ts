import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
import type { Principal } from "../auth/types.js";

type Row = Record<string, unknown>;
type NotificationType =
  | "task_assignment"
  | "task_due_soon"
  | "task_overdue"
  | "deal_assignment"
  | "deal_stage_changed";

export class NotificationStore {
  constructor(
    private db: DatabaseSync,
    private clock = () => new Date(),
  ) {}
  generate(organizationId: string) {
    const now = this.clock(),
      nowIso = now.toISOString(),
      soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    let created = 0;
    const insert = this.db.prepare(`INSERT OR IGNORE INTO notifications
      (id,organization_id,recipient_id,deduplication_key,kind,title,body,entity_type,entity_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const add = (
      recipient: string,
      key: string,
      type: NotificationType,
      title: string,
      body: string,
      entityType: string,
      entityId: string,
      createdAt = nowIso,
    ) => {
      const result = insert.run(
        randomUUID(),
        organizationId,
        recipient,
        key,
        type,
        title,
        body,
        entityType,
        entityId,
        createdAt,
      ) as Row;
      created += Number(result.changes ?? 0);
    };
    const tasks = this.db
      .prepare(
        `SELECT id,title,assignee_id,due_at,updated_at FROM tasks
      WHERE organization_id=? AND status='open' AND archived_at IS NULL`,
      )
      .all(organizationId) as Row[];
    for (const task of tasks) {
      const id = String(task.id),
        recipient = String(task.assignee_id),
        title = String(task.title),
        due = task.due_at === null ? null : String(task.due_at);
      add(
        recipient,
        `task:${id}:assigned:${recipient}`,
        "task_assignment",
        "Task assigned",
        title,
        "task",
        id,
        String(task.updated_at),
      );
      if (due && due < nowIso)
        add(
          recipient,
          `task:${id}:overdue:${due}`,
          "task_overdue",
          "Task overdue",
          `${title} was due ${due}.`,
          "task",
          id,
        );
      else if (due && due >= nowIso && due <= soon)
        add(
          recipient,
          `task:${id}:due-soon:${due}`,
          "task_due_soon",
          "Task due soon",
          `${title} is due ${due}.`,
          "task",
          id,
        );
    }
    const deals = this.db
      .prepare(
        `SELECT d.id,d.name,d.owner_id,d.updated_at FROM deals d
      WHERE d.organization_id=? AND d.archived_at IS NULL`,
      )
      .all(organizationId) as Row[];
    for (const deal of deals)
      add(
        String(deal.owner_id),
        `deal:${String(deal.id)}:assigned:${String(deal.owner_id)}`,
        "deal_assignment",
        "Deal assigned",
        String(deal.name),
        "deal",
        String(deal.id),
        String(deal.updated_at),
      );
    const transitions = this.db
      .prepare(
        `SELECT h.id,h.deal_id,h.occurred_at,d.name,d.owner_id,s.name stage_name
      FROM deal_stage_history h JOIN deals d ON d.id=h.deal_id AND d.organization_id=h.organization_id
      JOIN pipeline_stages s ON s.id=h.to_stage_id AND s.organization_id=h.organization_id
      WHERE h.organization_id=? AND NOT EXISTS (
        SELECT 1 FROM notifications n WHERE n.organization_id=h.organization_id
        AND n.deduplication_key='deal:'||h.deal_id||':stage:'||h.id
      )`,
      )
      .all(organizationId) as Row[];
    for (const event of transitions)
      add(
        String(event.owner_id),
        `deal:${String(event.deal_id)}:stage:${String(event.id)}`,
        "deal_stage_changed",
        "Deal stage changed",
        `${String(event.name)} moved to ${String(event.stage_name)}.`,
        "deal",
        String(event.deal_id),
        String(event.occurred_at),
      );
    return { created, asOf: nowIso };
  }
  list(user: Principal, query: Row) {
    this.generate(user.organizationId);
    const page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const clauses = ["organization_id=?", "recipient_id=?"],
      args: SQLInputValue[] = [user.organizationId, user.userId];
    if (query.unread === "true") clauses.push("read_at IS NULL");
    if (typeof query.type === "string" && query.type) {
      clauses.push("kind=?");
      args.push(query.type);
    }
    const where = clauses.join(" AND ");
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) count FROM notifications WHERE ${where}`)
          .get(...args) as Row
      ).count,
    );
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as Row[];
    return {
      items: rows.map(this.json),
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      unread: Number(
        (
          this.db
            .prepare(
              "SELECT count(*) count FROM notifications WHERE organization_id=? AND recipient_id=? AND read_at IS NULL",
            )
            .get(user.organizationId, user.userId) as Row
        ).count,
      ),
    };
  }
  markRead(user: Principal, id: string) {
    const now = this.clock().toISOString();
    const result = this.db
      .prepare(
        "UPDATE notifications SET read_at=coalesce(read_at,?) WHERE id=? AND organization_id=? AND recipient_id=?",
      )
      .run(now, id, user.organizationId, user.userId) as Row;
    if (Number(result.changes ?? 0) === 0)
      throw new AuthError("unauthenticated", "Notification not found.");
    return this.json(
      this.db
        .prepare(
          "SELECT * FROM notifications WHERE id=? AND organization_id=? AND recipient_id=?",
        )
        .get(id, user.organizationId, user.userId) as Row,
    );
  }
  markAllRead(user: Principal) {
    const result = this.db
      .prepare(
        "UPDATE notifications SET read_at=? WHERE organization_id=? AND recipient_id=? AND read_at IS NULL",
      )
      .run(
        this.clock().toISOString(),
        user.organizationId,
        user.userId,
      ) as Row;
    return { updated: Number(result.changes ?? 0) };
  }
  private json = (row: Row) => ({
    id: String(row.id),
    type: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    entityType: row.entity_type === null ? null : String(row.entity_type),
    entityId: row.entity_id === null ? null : String(row.entity_id),
    href:
      row.entity_type && row.entity_id
        ? `/${String(row.entity_type)}s/${String(row.entity_id)}`
        : null,
    createdAt: String(row.created_at),
    readAt: row.read_at === null ? null : String(row.read_at),
  });
}

export function notificationsRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router(),
    store = new NotificationStore(database),
    auth = new AuthService(new SqliteAuthRepository(database));
  const authenticate = async (request: Request) =>
    auth.authenticate(readSessionCookie(request.headers.cookie));
  const mutation = async (request: Request) => {
    const user = await authenticate(request);
    if (
      !requestHasTrustedOrigin(
        request.header("origin"),
        request.header("host"),
        secureCookies,
      )
    )
      throw new AuthError("forbidden", "The request origin is not allowed.");
    return user;
  };
  router.get("/", async (request, response, next) => {
    try {
      const user = await authenticate(request);
      response.json(store.list(user, request.query));
    } catch (error) {
      next(error);
    }
  });
  router.post("/generate", async (request, response, next) => {
    try {
      const user = await mutation(request);
      response.json(store.generate(user.organizationId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/read-all", async (request, response, next) => {
    try {
      response.json(store.markAllRead(await mutation(request)));
    } catch (error) {
      next(error);
    }
  });
  router.patch("/:notificationId/read", async (request, response, next) => {
    try {
      response.json({
        notification: store.markRead(
          await mutation(request),
          String(request.params.notificationId),
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
