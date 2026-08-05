import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const allowedTypes = new Set([
  "assignment",
  "task_due_soon",
  "task_overdue",
  "deal_change",
]);

export class NotificationStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock = () => new Date(),
  ) {}

  generate(organizationId: string) {
    const now = this.clock();
    const nowIso = now.toISOString();
    const soonIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare(`INSERT OR IGNORE INTO notifications
        (id,organization_id,recipient_membership_id,deduplication_key,type,title,body,entity_type,entity_id,created_at,read_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`);
      const events = this.db
        .prepare(
          `SELECT a.id,a.action,a.entity_id,a.summary_json,a.created_at,d.owner_membership_id,d.name deal_name
        FROM audit_events a LEFT JOIN deals d ON d.id=a.entity_id AND d.organization_id=a.organization_id
        WHERE a.organization_id=? AND a.action IN ('task.created','task.updated','deal.stage_changed') ORDER BY a.created_at,a.id`,
        )
        .all(organizationId) as Row[];
      for (const event of events) {
        const summary = this.json(event.summary_json);
        if (
          event.action === "task.created" ||
          (event.action === "task.updated" &&
            summary.fromAssigneeMembershipId !== summary.toAssigneeMembershipId)
        ) {
          const recipient =
            event.action === "task.created"
              ? summary.assigneeMembershipId
              : summary.toAssigneeMembershipId;
          if (
            typeof recipient === "string" &&
            this.activeMember(organizationId, recipient)
          ) {
            const task = this.db
              .prepare(
                "SELECT title FROM tasks WHERE id=? AND organization_id=?",
              )
              .get(event.entity_id, organizationId) as Row | undefined;
            if (task)
              insert.run(
                randomUUID(),
                organizationId,
                recipient,
                `assignment:${String(event.id)}`,
                "assignment",
                "Task assigned to you",
                String(task.title),
                "task",
                event.entity_id,
                event.created_at,
              );
          }
        } else if (
          event.action === "deal.stage_changed" &&
          event.owner_membership_id &&
          this.activeMember(organizationId, String(event.owner_membership_id))
        ) {
          insert.run(
            randomUUID(),
            organizationId,
            event.owner_membership_id,
            `deal-change:${String(event.id)}`,
            "deal_change",
            `Deal moved to ${String(summary.to ?? "a new stage")}`,
            String(event.deal_name ?? "A deal changed"),
            "deal",
            event.entity_id,
            event.created_at,
          );
        }
      }
      const tasks = this.db
        .prepare(
          `SELECT id,title,assignee_membership_id,due_at FROM tasks
        WHERE organization_id=? AND status='open' AND archived_at IS NULL AND due_at IS NOT NULL AND due_at<?`,
        )
        .all(organizationId, soonIso) as Row[];
      for (const task of tasks) {
        const recipient = String(task.assignee_membership_id);
        if (!this.activeMember(organizationId, recipient)) continue;
        const overdue = String(task.due_at) < nowIso;
        insert.run(
          randomUUID(),
          organizationId,
          recipient,
          `${overdue ? "overdue" : "due-soon"}:${String(task.id)}:${String(task.due_at)}`,
          overdue ? "task_overdue" : "task_due_soon",
          overdue ? "Task overdue" : "Task due within 24 hours",
          String(task.title),
          "task",
          task.id,
          nowIso,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(user: AuthenticatedUser, query: Row) {
    this.generate(user.organization.id);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const clauses = ["n.organization_id=?", "n.recipient_membership_id=?"];
    const args: unknown[] = [user.organization.id, user.membershipId];
    if (query.unread === "true") clauses.push("n.read_at IS NULL");
    if (typeof query.type === "string" && allowedTypes.has(query.type)) {
      clauses.push("n.type=?");
      args.push(query.type);
    }
    const where = clauses.join(" AND ");
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) total FROM notifications n WHERE ${where}`)
          .get(...args) as Row
      ).total,
    );
    const unread = Number(
      (
        this.db
          .prepare(
            "SELECT count(*) total FROM notifications WHERE organization_id=? AND recipient_membership_id=? AND read_at IS NULL",
          )
          .get(user.organization.id, user.membershipId) as Row
      ).total,
    );
    const rows = this.db
      .prepare(
        `SELECT n.* FROM notifications n WHERE ${where} ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as Row[];
    return {
      items: rows.map((row) => this.serialize(user.organization.id, row)),
      total,
      unread,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  markRead(user: AuthenticatedUser, id: string) {
    const now = this.clock().toISOString();
    const result = this.db
      .prepare(
        "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND organization_id=? AND recipient_membership_id=?",
      )
      .run(now, id, user.organization.id, user.membershipId) as Row;
    if (Number(result.changes) === 0)
      throw new AuthError(404, "NOT_FOUND", "Notification not found.");
    return this.db
      .prepare(
        "SELECT * FROM notifications WHERE id=? AND organization_id=? AND recipient_membership_id=?",
      )
      .get(id, user.organization.id, user.membershipId) as Row;
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
    return Number(result.changes);
  }

  private serialize(org: string, row: Row) {
    let href: string | null = null;
    if (
      row.entity_type === "task" &&
      this.db
        .prepare(
          "SELECT 1 FROM tasks WHERE id=? AND organization_id=? AND archived_at IS NULL",
        )
        .get(row.entity_id, org)
    )
      href = `#tasks?q=${encodeURIComponent(String(row.body))}`;
    if (
      row.entity_type === "deal" &&
      this.db
        .prepare(
          "SELECT 1 FROM deals WHERE id=? AND organization_id=? AND archived_at IS NULL",
        )
        .get(row.entity_id, org)
    )
      href = `#deals/${encodeURIComponent(String(row.entity_id))}`;
    return {
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      body: String(row.body),
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: String(row.created_at),
      readAt: row.read_at === null ? null : String(row.read_at),
      href,
    };
  }
  private activeMember(org: string, id: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM memberships WHERE id=? AND organization_id=? AND status='active'",
        )
        .get(id, org),
    );
  }
  private json(value: unknown): Record<string, unknown> {
    try {
      const result = JSON.parse(String(value));
      return result && typeof result === "object" ? result : {};
    } catch {
      return {};
    }
  }
}

export function notificationsRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const store = new NotificationStore(db);
  const actor = async (request: Request) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      ["owner", "member", "viewer"],
    );
  router.get("/", async (req, res, next) => {
    try {
      res.json(store.list(await actor(req), req.query as Row));
    } catch (error) {
      next(error);
    }
  });
  router.post("/read-all", async (req, res, next) => {
    try {
      res.json({ updated: store.markAllRead(await actor(req)) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/read", async (req, res, next) => {
    try {
      const user = await actor(req);
      res.json({ notification: store.markRead(user, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
