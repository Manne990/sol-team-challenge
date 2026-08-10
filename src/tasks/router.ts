import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
import type { Principal } from "../auth/types.js";

type Row = Record<string, unknown>;
type Input = {
  title?: unknown;
  description?: unknown;
  assigneeId?: unknown;
  dueAt?: unknown;
  priority?: unknown;
  status?: unknown;
  companyId?: unknown;
  contactId?: unknown;
  dealId?: unknown;
  version?: unknown;
};
const priorities = new Set(["low", "normal", "high", "urgent"]),
  statuses = new Set(["open", "in_progress", "completed"]);
class TaskError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const required = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
const optional = (value: unknown, max = 100) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
function parse(body: Input) {
  const title = required(body.title, 200),
    assigneeId = required(body.assigneeId, 100),
    due = typeof body.dueAt === "string" ? new Date(body.dueAt) : new Date(NaN),
    priority = String(body.priority ?? "normal"),
    status = String(body.status ?? "open");
  if (!title)
    throw new TaskError(
      400,
      "VALIDATION",
      "Task title is required and must be 200 characters or fewer.",
    );
  if (!assigneeId)
    throw new TaskError(400, "VALIDATION", "Choose an assignee.");
  if (!Number.isFinite(due.getTime()))
    throw new TaskError(400, "VALIDATION", "Enter a valid due date and time.");
  if (!priorities.has(priority) || !statuses.has(status))
    throw new TaskError(
      400,
      "VALIDATION",
      "Choose a valid priority and status.",
    );
  return {
    title,
    description: optional(body.description, 5000) ?? "",
    assigneeId,
    dueAt: due.toISOString(),
    priority,
    status,
    companyId: optional(body.companyId),
    contactId: optional(body.contactId),
    dealId: optional(body.dealId),
  };
}
function task(row: Row, now = new Date()) {
  const dueAt = String(row.due_at),
    completed = String(row.status) === "completed",
    day = now.toISOString().slice(0, 10),
    dueDay = dueAt.slice(0, 10);
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    assigneeId: String(row.assignee_id),
    assigneeName: String(row.assignee_name),
    dueAt,
    priority: String(row.priority),
    status: String(row.status),
    companyId: row.company_id ? String(row.company_id) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    contactId: row.contact_id ? String(row.contact_id) : null,
    contactName: row.contact_name ? String(row.contact_name) : null,
    dealId: row.deal_id ? String(row.deal_id) : null,
    dealName: row.deal_name ? String(row.deal_name) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    version: Number(row.version),
    dueState: completed
      ? "completed"
      : Date.parse(dueAt) < now.getTime()
        ? "overdue"
        : dueDay === day
          ? "due_today"
          : "upcoming",
  };
}
function errorResponse(error: unknown, response: Response) {
  if (error instanceof TaskError)
    response
      .status(error.statusCode)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(error.code === "forbidden" ? 403 : 401)
      .json({ error: { code: error.code, message: error.message } });
  else throw error;
}
export function createTasksRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router(),
    auth = new AuthService(new SqliteAuthRepository(database));
  const principal = (request: Request) =>
    auth.authenticate(readSessionCookie(request.header("cookie")));
  const mutate = async (request: Request) => {
    const actor = await principal(request);
    auth.requireMutation(actor);
    if (
      !requestHasTrustedOrigin(
        request.header("origin"),
        request.header("host"),
        secureCookies,
      )
    )
      throw new AuthError("forbidden", "The request origin is not allowed.");
    return actor;
  };
  const select =
    "SELECT t.*,u.display_name assignee_name,c.name company_name,(ct.first_name||' '||ct.last_name) contact_name,d.name deal_name FROM tasks t JOIN users u ON u.id=t.assignee_id LEFT JOIN companies c ON c.organization_id=t.organization_id AND c.id=t.company_id LEFT JOIN contacts ct ON ct.organization_id=t.organization_id AND ct.id=t.contact_id LEFT JOIN deals d ON d.organization_id=t.organization_id AND d.id=t.deal_id";
  const find = (id: string, actor: Principal) =>
    database
      .prepare(`${select} WHERE t.id=? AND t.organization_id=?`)
      .get(id, actor.organizationId) as Row | undefined;
  function validateRelations(
    actor: Principal,
    value: ReturnType<typeof parse>,
  ) {
    if (
      !database
        .prepare(
          "SELECT 1 FROM memberships WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
        )
        .get(actor.organizationId, value.assigneeId)
    )
      throw new TaskError(
        400,
        "INVALID_ASSIGNEE",
        "Choose an active member of this organization.",
      );
    for (const [id, table] of [
      [value.companyId, "companies"],
      [value.contactId, "contacts"],
      [value.dealId, "deals"],
    ] as const)
      if (
        id &&
        !database
          .prepare(`SELECT 1 FROM ${table} WHERE organization_id=? AND id=?`)
          .get(actor.organizationId, id)
      )
        throw new TaskError(
          400,
          "INVALID_RELATION",
          "Choose related records from this organization.",
        );
  }
  router.get("/meta", async (request, response) => {
    try {
      const actor = await principal(request);
      const members = database
        .prepare(
          "SELECT m.user_id id,u.display_name name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.revoked_at IS NULL ORDER BY u.display_name",
        )
        .all(actor.organizationId);
      response.json({ members, timezone: "UTC" });
    } catch (error) {
      errorResponse(error, response);
    }
  });
  router.get("/", async (request, response) => {
    try {
      const actor = await principal(request),
        page = Math.max(1, Number(request.query.page) || 1),
        pageSize = Math.min(
          100,
          Math.max(1, Number(request.query.pageSize) || 20),
        ),
        now = new Date(),
        today = now.toISOString().slice(0, 10),
        tomorrow = new Date(`${today}T00:00:00.000Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const where = ["t.organization_id=?"],
        values: SQLInputValue[] = [actor.organizationId];
      if (request.query.archived !== "true")
        where.push("t.archived_at IS NULL");
      const view = String(request.query.view ?? "");
      if (view === "mine") {
        where.push("t.assignee_id=?");
        values.push(actor.userId);
      } else if (view === "overdue") {
        where.push("t.status!='completed' AND t.due_at<?");
        values.push(now.toISOString());
      } else if (view === "today") {
        where.push("t.status!='completed' AND substr(t.due_at,1,10)=?");
        values.push(today);
      } else if (view === "upcoming") {
        where.push("t.status!='completed' AND t.due_at>=?");
        values.push(tomorrow.toISOString());
      } else if (view === "completed") where.push("t.status='completed'");
      for (const [query, column] of [
        ["company", "t.company_id"],
        ["contact", "t.contact_id"],
        ["deal", "t.deal_id"],
        ["assignee", "t.assignee_id"],
      ] as const)
        if (typeof request.query[query] === "string" && request.query[query]) {
          where.push(`${column}=?`);
          values.push(String(request.query[query]));
        }
      const clause = where.join(" AND "),
        total = Number(
          (
            database
              .prepare(`SELECT count(*) total FROM tasks t WHERE ${clause}`)
              .get(...values) as Row
          ).total,
        ),
        rows = database
          .prepare(
            `${select} WHERE ${clause} ORDER BY CASE t.status WHEN 'completed' THEN 1 ELSE 0 END,t.due_at,t.id LIMIT ? OFFSET ?`,
          )
          .all(...values, pageSize, (page - 1) * pageSize) as Row[];
      response.json({
        items: rows.map((row) => task(row, now)),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        asOf: now.toISOString(),
        timezone: "UTC",
      });
    } catch (error) {
      errorResponse(error, response);
    }
  });
  router.get("/:id", async (request, response) => {
    try {
      const actor = await principal(request),
        row = find(request.params.id, actor);
      if (!row)
        throw new TaskError(
          404,
          "NOT_FOUND",
          "The requested task was not found.",
        );
      response.json(task(row));
    } catch (error) {
      errorResponse(error, response);
    }
  });
  router.post("/", async (request, response) => {
    try {
      const actor = await mutate(request),
        value = parse(request.body as Input);
      validateRelations(actor, value);
      const id = randomUUID(),
        now = new Date().toISOString(),
        completedAt = value.status === "completed" ? now : null;
      database
        .prepare(
          "INSERT INTO tasks(id,organization_id,title,description,assignee_id,due_at,priority,status,company_id,contact_id,deal_id,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          actor.organizationId,
          value.title,
          value.description,
          value.assigneeId,
          value.dueAt,
          value.priority,
          value.status,
          value.companyId,
          value.contactId,
          value.dealId,
          now,
          now,
          completedAt,
        );
      response.status(201).json(task(find(id, actor)!));
    } catch (error) {
      errorResponse(error, response);
    }
  });
  router.put("/:id", async (request, response) => {
    try {
      const actor = await mutate(request),
        value = parse(request.body as Input);
      validateRelations(actor, value);
      const version = Number(request.body.version);
      if (!Number.isInteger(version))
        throw new TaskError(
          400,
          "VALIDATION",
          "The record version is required.",
        );
      const now = new Date().toISOString(),
        completedAt = value.status === "completed" ? now : null,
        result = database
          .prepare(
            "UPDATE tasks SET title=?,description=?,assignee_id=?,due_at=?,priority=?,status=?,company_id=?,contact_id=?,deal_id=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(
            value.title,
            value.description,
            value.assigneeId,
            value.dueAt,
            value.priority,
            value.status,
            value.companyId,
            value.contactId,
            value.dealId,
            completedAt,
            now,
            request.params.id,
            actor.organizationId,
            version,
          );
      if (result.changes !== 1) {
        if (!find(request.params.id, actor))
          throw new TaskError(
            404,
            "NOT_FOUND",
            "The requested task was not found.",
          );
        throw new TaskError(
          409,
          "EDIT_CONFLICT",
          "This task changed since you opened it. Refresh and compare before saving.",
        );
      }
      response.json(task(find(request.params.id, actor)!));
    } catch (error) {
      errorResponse(error, response);
    }
  });
  router.post("/:id/:action", async (request, response) => {
    try {
      const actor = await mutate(request),
        row = find(request.params.id, actor);
      if (!row)
        throw new TaskError(
          404,
          "NOT_FOUND",
          "The requested task was not found.",
        );
      const action = request.params.action,
        now = new Date().toISOString();
      let sql: string,
        values: SQLInputValue[] = [];
      if (action === "complete") {
        sql = "status='completed',completed_at=?";
        values = [now];
      } else if (action === "reopen") {
        sql = "status='open',completed_at=NULL";
      } else if (action === "archive") {
        sql = "archived_at=?";
        values = [now];
      } else if (action === "restore") {
        sql = "archived_at=NULL";
      } else
        throw new TaskError(
          404,
          "NOT_FOUND",
          "The requested action was not found.",
        );
      database
        .prepare(
          `UPDATE tasks SET ${sql},updated_at=?,version=version+1 WHERE id=? AND organization_id=?`,
        )
        .run(...values, now, request.params.id, actor.organizationId);
      response.json(task(find(request.params.id, actor)!));
    } catch (error) {
      errorResponse(error, response);
    }
  });
  return router;
}
