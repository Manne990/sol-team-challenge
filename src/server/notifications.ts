import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
type NotificationType =
  | "task_assignment"
  | "task_due_soon"
  | "task_overdue"
  | "deal_assignment"
  | "deal_stage_changed";

export class NotificationStore {
  constructor(
    private db: SqliteDatabase,
    private clock = () => new Date(),
  ) {}
  generate(organizationId: string) {
    const now = this.clock(),
      nowIso = now.toISOString(),
      soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    let created = 0;
    const insert = this.db.prepare(`INSERT OR IGNORE INTO notifications
      (id,organization_id,recipient_membership_id,deduplication_key,type,title,body,entity_type,entity_id,created_at)
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
        `SELECT id,title,assignee_membership_id,due_at,updated_at FROM tasks
      WHERE organization_id=? AND status='open' AND archived_at IS NULL`,
      )
      .all(organizationId) as Row[];
    for (const task of tasks) {
      const id = String(task.id),
        recipient = String(task.assignee_membership_id),
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
        `SELECT d.id,d.name,d.owner_membership_id,d.updated_at FROM deals d
      WHERE d.organization_id=? AND d.archived_at IS NULL`,
      )
      .all(organizationId) as Row[];
    for (const deal of deals)
      add(
        String(deal.owner_membership_id),
        `deal:${String(deal.id)}:assigned:${String(deal.owner_membership_id)}`,
        "deal_assignment",
        "Deal assigned",
        String(deal.name),
        "deal",
        String(deal.id),
        String(deal.updated_at),
      );
    const transitions = this.db
      .prepare(
        `SELECT h.id,h.deal_id,h.moved_at,d.name,d.owner_membership_id,s.name stage_name
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
        String(event.owner_membership_id),
        `deal:${String(event.deal_id)}:stage:${String(event.id)}`,
        "deal_stage_changed",
        "Deal stage changed",
        `${String(event.name)} moved to ${String(event.stage_name)}.`,
        "deal",
        String(event.deal_id),
        String(event.moved_at),
      );
    return { created, asOf: nowIso };
  }
  list(user: AuthenticatedUser, query: Row) {
    this.generate(user.organization.id);
    const page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const clauses = ["organization_id=?", "recipient_membership_id=?"],
      args: unknown[] = [user.organization.id, user.membershipId];
    if (query.unread === "true") clauses.push("read_at IS NULL");
    if (typeof query.type === "string" && query.type) {
      clauses.push("type=?");
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
              "SELECT count(*) count FROM notifications WHERE organization_id=? AND recipient_membership_id=? AND read_at IS NULL",
            )
            .get(user.organization.id, user.membershipId) as Row
        ).count,
      ),
    };
  }
  markRead(user: AuthenticatedUser, id: string) {
    const now = this.clock().toISOString();
    const result = this.db
      .prepare(
        "UPDATE notifications SET read_at=coalesce(read_at,?) WHERE id=? AND organization_id=? AND recipient_membership_id=?",
      )
      .run(now, id, user.organization.id, user.membershipId) as Row;
    if (Number(result.changes ?? 0) === 0)
      throw new AuthError(404, "NOT_FOUND", "Notification not found.");
    return this.json(
      this.db
        .prepare(
          "SELECT * FROM notifications WHERE id=? AND organization_id=? AND recipient_membership_id=?",
        )
        .get(id, user.organization.id, user.membershipId) as Row,
    );
  }
  markAllRead(user: AuthenticatedUser) {
    const result = this.db
      .prepare(
        "UPDATE notifications SET read_at=? WHERE organization_id=? AND recipient_membership_id=? AND read_at IS NULL",
      )
      .run(
        this.clock().toISOString(),
        user.organization.id,
        user.membershipId,
      ) as Row;
    return { updated: Number(result.changes ?? 0) };
  }
  private json = (row: Row) => ({
    id: String(row.id),
    type: String(row.type),
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
  database: SqliteDatabase,
  auth: AuthService,
) {
  const router = Router(),
    store = new NotificationStore(database);
  const authenticate = async (request: Request) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      ["owner", "member", "viewer"],
    );
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
      const user = await authenticate(request);
      response.json(store.generate(user.organization.id));
    } catch (error) {
      next(error);
    }
  });
  router.post("/read-all", async (request, response, next) => {
    try {
      response.json(store.markAllRead(await authenticate(request)));
    } catch (error) {
      next(error);
    }
  });
  router.patch("/:notificationId/read", async (request, response, next) => {
    try {
      response.json({
        notification: store.markRead(
          await authenticate(request),
          String(request.params.notificationId),
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
