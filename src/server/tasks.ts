import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
type TaskInput = {
  title: string;
  description: string;
  assigneeMembershipId: string;
  dueAt: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
};

const priorities = new Set(["low", "normal", "high", "urgent"]);
const sorts: Record<string, string> = {
  dueAt: "t.due_at",
  priority:
    "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END",
  title: "t.title",
  createdAt: "t.created_at",
  updatedAt: "t.updated_at",
};
const validation = (message: string) =>
  new AuthError(400, "VALIDATION_ERROR", message);
const optionalText = (value: unknown, maximum: number) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maximum)
    throw validation("Check the task fields and try again.");
  return value.trim() || null;
};
function parseInput(body: unknown): TaskInput {
  if (!body || typeof body !== "object")
    throw validation("Enter task details.");
  const data = body as Row;
  const title = optionalText(data.title, 160);
  const assigneeMembershipId = optionalText(data.assigneeMembershipId, 100);
  if (!title) throw validation("Enter a task title.");
  if (!assigneeMembershipId) throw validation("Choose an assignee.");
  if (!priorities.has(String(data.priority)))
    throw validation("Choose a valid priority.");
  const dueAt = optionalText(data.dueAt, 40);
  if (
    dueAt &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/u.test(dueAt) ||
      Number.isNaN(Date.parse(dueAt)))
  )
    throw validation("Enter the due time in UTC.");
  return {
    title,
    description: optionalText(data.description, 5000) ?? "",
    assigneeMembershipId,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    priority: String(data.priority) as TaskInput["priority"],
    companyId: optionalText(data.companyId, 100),
    contactId: optionalText(data.contactId, 100),
    dealId: optionalText(data.dealId, 100),
  };
}

const selectTask = `SELECT t.*,
  trim(u.first_name||' '||u.last_name) assignee_name,
  c.name company_name,
  trim(co.first_name||' '||co.last_name) contact_name,
  d.name deal_name
  FROM tasks t
  JOIN memberships m ON m.id=t.assignee_membership_id AND m.organization_id=t.organization_id
  JOIN users u ON u.id=m.user_id
  LEFT JOIN companies c ON c.id=t.company_id AND c.organization_id=t.organization_id
  LEFT JOIN contacts co ON co.id=t.contact_id AND co.organization_id=t.organization_id
  LEFT JOIN deals d ON d.id=t.deal_id AND d.organization_id=t.organization_id`;
const taskJson = (row: Row) => ({
  id: String(row.id),
  title: String(row.title),
  description: String(row.description),
  assignee: {
    id: String(row.assignee_membership_id),
    name: String(row.assignee_name),
  },
  dueAt: row.due_at === null ? null : String(row.due_at),
  priority: String(row.priority),
  status: String(row.status),
  company: row.company_id
    ? { id: String(row.company_id), name: String(row.company_name) }
    : null,
  contact: row.contact_id
    ? { id: String(row.contact_id), name: String(row.contact_name) }
    : null,
  deal: row.deal_id
    ? { id: String(row.deal_id), name: String(row.deal_name) }
    : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  completedAt: row.completed_at === null ? null : String(row.completed_at),
  archivedAt: row.archived_at === null ? null : String(row.archived_at),
  version: Number(row.version),
});

export class TaskStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock = () => new Date(),
  ) {}

  list(user: AuthenticatedUser, query: Row) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const clauses = ["t.organization_id=?"];
    const args: unknown[] = [user.organization.id];
    const now = this.clock();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const startToday = `${today}T00:00:00.000Z`;
    const startTomorrow = tomorrow.toISOString();
    const view = String(query.view ?? "open");
    if (view === "archived") {
      clauses.push("t.archived_at IS NOT NULL");
    } else {
      clauses.push("t.archived_at IS NULL");
      if (view === "overdue") {
        clauses.push("t.status='open'", "t.due_at IS NOT NULL", "t.due_at<?");
        args.push(now.toISOString());
      } else if (view === "today") {
        clauses.push("t.status='open'", "t.due_at>=?", "t.due_at<?");
        args.push(startToday, startTomorrow);
      } else if (view === "upcoming") {
        clauses.push("t.status='open'", "t.due_at>=?");
        args.push(startTomorrow);
      } else if (view === "completed") clauses.push("t.status='completed'");
      else clauses.push("t.status='open'");
    }
    if (query.assignedToMe === "true") {
      clauses.push("t.assignee_membership_id=?");
      args.push(user.membershipId);
    } else if (typeof query.assignee === "string" && query.assignee) {
      clauses.push("t.assignee_membership_id=?");
      args.push(query.assignee);
    }
    for (const [key, column] of [
      ["company", "t.company_id"],
      ["contact", "t.contact_id"],
      ["deal", "t.deal_id"],
      ["priority", "t.priority"],
    ] as const) {
      if (typeof query[key] === "string" && query[key]) {
        clauses.push(`${column}=?`);
        args.push(query[key]);
      }
    }
    if (typeof query.q === "string" && query.q.trim()) {
      clauses.push("(t.title LIKE ? OR t.description LIKE ?)");
      const search = `%${query.q.trim()}%`;
      args.push(search, search);
    }
    const where = clauses.join(" AND ");
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) total FROM tasks t WHERE ${where}`)
          .get(...args) as Row
      ).total,
    );
    const sort =
      sorts[String(query.sort)] ??
      "CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at";
    const order = query.order === "desc" ? "DESC" : "ASC";
    const rows = this.db
      .prepare(
        `${selectTask} WHERE ${where} ORDER BY ${sort} ${order},t.id ${order} LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as Row[];
    return {
      items: rows.map(taskJson),
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      timezone: "UTC",
      asOf: now.toISOString(),
    };
  }

  detail(organizationId: string, id: string) {
    const row = this.db
      .prepare(`${selectTask} WHERE t.organization_id=? AND t.id=?`)
      .get(organizationId, id) as Row | undefined;
    return row ? taskJson(row) : undefined;
  }

  write(
    user: AuthenticatedUser,
    id: string | undefined,
    data: TaskInput,
    expectedVersion?: number,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.verifyRelations(user.organization.id, data);
      const now = this.clock().toISOString();
      const taskId = id ?? randomUUID();
      if (id) {
        const existing = this.detail(user.organization.id, id);
        if (!existing) throw new AuthError(404, "NOT_FOUND", "Task not found.");
        if (existing.archivedAt)
          throw new AuthError(
            409,
            "TASK_ARCHIVED",
            "Restore this task before editing it.",
          );
        const result = this.db
          .prepare(
            `UPDATE tasks SET title=?,description=?,assignee_membership_id=?,due_at=?,priority=?,company_id=?,contact_id=?,deal_id=?,updated_at=?,version=version+1
          WHERE id=? AND organization_id=? AND version=?`,
          )
          .run(
            data.title,
            data.description,
            data.assigneeMembershipId,
            data.dueAt,
            data.priority,
            data.companyId,
            data.contactId,
            data.dealId,
            now,
            id,
            user.organization.id,
            expectedVersion,
          );
        if (Number((result as Row).changes) === 0)
          throw new AuthError(
            409,
            "EDIT_CONFLICT",
            "This task changed. Refresh and review the latest version.",
          );
        this.audit(
          user,
          "task.updated",
          taskId,
          { version: expectedVersion },
          now,
        );
      } else {
        this.db
          .prepare(
            `INSERT INTO tasks (id,organization_id,title,description,assignee_membership_id,due_at,priority,status,company_id,contact_id,deal_id,created_at,updated_at,completed_at)
          VALUES(?,?,?,?,?,?,?,'open',?,?,?,?,?,NULL)`,
          )
          .run(
            taskId,
            user.organization.id,
            data.title,
            data.description,
            data.assigneeMembershipId,
            data.dueAt,
            data.priority,
            data.companyId,
            data.contactId,
            data.dealId,
            now,
            now,
          );
        this.audit(
          user,
          "task.created",
          taskId,
          {
            assigneeMembershipId: data.assigneeMembershipId,
            dueAt: data.dueAt,
          },
          now,
        );
      }
      this.db.exec("COMMIT");
      return this.detail(user.organization.id, taskId)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  transition(
    user: AuthenticatedUser,
    id: string,
    action: "complete" | "reopen" | "archive" | "restore",
    version: number,
  ) {
    const now = this.clock().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.detail(user.organization.id, id);
      if (!before) throw new AuthError(404, "NOT_FOUND", "Task not found.");
      const invalid =
        action === "complete"
          ? before.status !== "open" || Boolean(before.archivedAt)
          : action === "reopen"
            ? before.status !== "completed" || Boolean(before.archivedAt)
            : action === "archive"
              ? Boolean(before.archivedAt)
              : !before.archivedAt;
      if (invalid)
        throw new AuthError(
          409,
          "INVALID_TRANSITION",
          `This task cannot be ${action}d from its current state.`,
        );
      const target =
        action === "complete"
          ? "completed"
          : action === "reopen"
            ? "open"
            : before.status;
      const completedAt =
        action === "complete"
          ? now
          : action === "reopen"
            ? null
            : before.completedAt;
      const archivedAt =
        action === "archive"
          ? now
          : action === "restore"
            ? null
            : before.archivedAt;
      const result = this.db
        .prepare(
          "UPDATE tasks SET status=?,completed_at=?,archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
        )
        .run(
          target,
          completedAt,
          archivedAt,
          now,
          id,
          user.organization.id,
          version,
        );
      if (Number((result as Row).changes) === 0)
        throw new AuthError(
          409,
          "EDIT_CONFLICT",
          "This task changed. Refresh and review the latest version.",
        );
      this.audit(
        user,
        `task.${action}d`,
        id,
        { from: before.status, to: target, archivedAt },
        now,
      );
      this.db.exec("COMMIT");
      return this.detail(user.organization.id, id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private verifyRelations(org: string, data: TaskInput) {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM memberships WHERE id=? AND organization_id=? AND status='active'",
        )
        .get(data.assigneeMembershipId, org)
    )
      throw validation("Choose an active assignee from this organization.");
    for (const [id, table] of [
      [data.companyId, "companies"],
      [data.contactId, "contacts"],
      [data.dealId, "deals"],
    ] as const) {
      if (
        id &&
        !this.db
          .prepare(`SELECT 1 FROM ${table} WHERE id=? AND organization_id=?`)
          .get(id, org)
      )
        throw new AuthError(
          403,
          "FORBIDDEN",
          "The related record is unavailable.",
        );
    }
  }

  private audit(
    user: AuthenticatedUser,
    action: string,
    id: string,
    summary: object,
    now: string,
  ) {
    this.db
      .prepare(
        `INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        user.organization.id,
        user.membershipId,
        action,
        "task",
        id,
        randomUUID(),
        JSON.stringify(summary),
        now,
      );
  }
}

export function tasksRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const store = new TaskStore(db);
  const actor = async (request: Request, mutable = false) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      mutable ? ["owner", "member"] : ["owner", "member", "viewer"],
    );
  const version = (body: unknown) => {
    const value = Number(
      body && typeof body === "object" ? (body as Row).version : NaN,
    );
    if (!Number.isInteger(value) || value < 1)
      throw validation("Refresh the task before changing it.");
    return value;
  };
  router.get("/", async (req, res, next) => {
    try {
      const user = await actor(req);
      res.json(store.list(user, req.query as Row));
    } catch (e) {
      next(e);
    }
  });
  router.get("/assignees", async (req, res, next) => {
    try {
      const user = await actor(req);
      const items = db
        .prepare(
          `SELECT m.id,trim(u.first_name||' '||u.last_name) name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.status='active' ORDER BY u.last_name,u.first_name,u.id`,
        )
        .all(user.organization.id) as Row[];
      res.json({
        items: items.map((item) => ({
          id: String(item.id),
          name: String(item.name),
        })),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const user = await actor(req);
      const item = store.detail(user.organization.id, String(req.params.id));
      if (!item) throw new AuthError(404, "NOT_FOUND", "Task not found.");
      res.json({ task: item });
    } catch (e) {
      next(e);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      res.status(201).json({
        task: store.write(
          await actor(req, true),
          undefined,
          parseInput(req.body),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.put("/:id", async (req, res, next) => {
    try {
      res.json({
        task: store.write(
          await actor(req, true),
          String(req.params.id),
          parseInput(req.body),
          version(req.body),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  for (const action of ["complete", "reopen", "archive", "restore"] as const)
    router.post(`/:id/${action}`, async (req, res, next) => {
      try {
        res.json({
          task: store.transition(
            await actor(req, true),
            String(req.params.id),
            action,
            version(req.body),
          ),
        });
      } catch (e) {
        next(e);
      }
    });
  return router;
}
