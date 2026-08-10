import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";

type Row = Record<string, unknown>;
const activityTypes = new Set([
  "call",
  "email",
  "meeting",
  "note",
  "status_change",
]);
const priorities = new Set(["low", "normal", "high", "urgent"]);

class ActivityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requiredText(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw new ActivityError(
      400,
      "VALIDATION",
      `${label} is required and must be ${maximum} characters or fewer.`,
    );
  return value.trim();
}
function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maximum)
    throw new ActivityError(
      400,
      "VALIDATION",
      `Text must be ${maximum} characters or fewer.`,
    );
  return value.trim() || null;
}
function utc(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ActivityError(
      400,
      "VALIDATION",
      `${label} must be a valid date and time.`,
    );
  return new Date(value).toISOString();
}
function json(row: Row) {
  return {
    id: String(row.id),
    type: String(row.type),
    subject: String(row.subject),
    body: String(row.body),
    occurredAt: String(row.occurred_at),
    creator: {
      id: String(row.creator_id),
      name: String(row.creator_name_snapshot),
    },
    company: row.company_id
      ? { id: String(row.company_id), name: String(row.company_name_snapshot) }
      : null,
    contact: row.contact_id
      ? { id: String(row.contact_id), name: String(row.contact_name_snapshot) }
      : null,
    deal: row.deal_id
      ? { id: String(row.deal_id), name: String(row.deal_name_snapshot) }
      : null,
    followUpTaskId: row.follow_up_task_id
      ? String(row.follow_up_task_id)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
  };
}

function send(error: unknown, response: Response) {
  if (error instanceof ActivityError)
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(error.code === "forbidden" ? 403 : 401)
      .json({ error: { code: error.code, message: error.message } });
  else throw error;
}

export function createActivitiesRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router();
  const auth = new AuthService(new SqliteAuthRepository(database));
  const principal = (request: Request) =>
    auth.authenticate(readSessionCookie(request.header("cookie")));
  const mutation = async (request: Request) => {
    const user = await principal(request);
    auth.requireMutation(user);
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
  const find = (organizationId: string, id: string) =>
    database
      .prepare("SELECT * FROM activities WHERE organization_id=? AND id=?")
      .get(organizationId, id) as Row | undefined;
  const related = (
    table: "companies" | "contacts" | "deals",
    organizationId: string,
    id: string | null,
  ) => {
    if (!id) return null;
    const label =
      table === "contacts" ? "first_name || ' ' || last_name" : "name";
    const row = database
      .prepare(
        `SELECT ${label} label FROM ${table} WHERE organization_id=? AND id=?`,
      )
      .get(organizationId, id) as Row | undefined;
    if (!row)
      throw new ActivityError(
        404,
        "NOT_FOUND",
        "A related record was not found.",
      );
    return String(row.label);
  };
  const audit = database.prepare(
    "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );

  router.get("/", async (request, response) => {
    try {
      const user = await principal(request);
      const page = Math.max(1, Number(request.query.page) || 1),
        pageSize = Math.min(
          100,
          Math.max(1, Number(request.query.pageSize) || 25),
        );
      const conditions = ["organization_id=?"],
        values: SQLInputValue[] = [user.organizationId];
      for (const [query, column] of [
        ["type", "type"],
        ["authorId", "creator_id"],
        ["companyId", "company_id"],
        ["contactId", "contact_id"],
        ["dealId", "deal_id"],
      ] as const) {
        const value = request.query[query];
        if (typeof value === "string" && value) {
          conditions.push(`${column}=?`);
          values.push(value);
        }
      }
      if (typeof request.query.from === "string" && request.query.from) {
        conditions.push("occurred_at>=?");
        values.push(utc(request.query.from, "From"));
      }
      if (typeof request.query.to === "string" && request.query.to) {
        conditions.push("occurred_at<=?");
        values.push(utc(request.query.to, "To"));
      }
      const where = conditions.join(" AND ");
      const sort =
        (
          {
            occurred: "occurred_at",
            subject: "subject",
            type: "type",
            updated: "updated_at",
          } as Record<string, string>
        )[String(request.query.sort)] ?? "occurred_at";
      const direction = request.query.direction === "asc" ? "ASC" : "DESC";
      const total = Number(
        (
          database
            .prepare(`SELECT count(*) total FROM activities WHERE ${where}`)
            .get(...values) as Row
        ).total,
      );
      const rows = database
        .prepare(
          `SELECT * FROM activities WHERE ${where} ORDER BY ${sort} ${direction},id ${direction} LIMIT ? OFFSET ?`,
        )
        .all(...values, pageSize, (page - 1) * pageSize) as Row[];
      response.json({
        items: rows.map(json),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      send(error, response);
    }
  });

  router.get("/:id", async (request, response) => {
    try {
      const user = await principal(request),
        row = find(user.organizationId, request.params.id);
      if (!row)
        throw new ActivityError(
          404,
          "NOT_FOUND",
          "The requested activity was not found.",
        );
      const participants = database
        .prepare(
          "SELECT contact_id id,display_name_snapshot name FROM activity_participants WHERE organization_id=? AND activity_id=? ORDER BY display_name_snapshot,contact_id",
        )
        .all(user.organizationId, request.params.id) as Row[];
      response.json({
        ...json(row),
        participants: participants.map((item) => ({
          id: String(item.id),
          name: String(item.name),
        })),
      });
    } catch (error) {
      send(error, response);
    }
  });

  router.post("/", async (request, response) => {
    try {
      const user = await mutation(request),
        body = request.body as Record<string, unknown>;
      const type = requiredText(body.type, "Activity type", 30);
      if (!activityTypes.has(type))
        throw new ActivityError(
          400,
          "VALIDATION",
          "Choose a valid activity type.",
        );
      const subject = requiredText(body.subject, "Subject", 200),
        narrative = optionalText(body.body, 10000) ?? "";
      const occurredAt = utc(body.occurredAt, "Occurred time"),
        companyId = optionalText(body.companyId, 100),
        contactId = optionalText(body.contactId, 100),
        dealId = optionalText(body.dealId, 100);
      const companyLabel = related("companies", user.organizationId, companyId),
        contactLabel = related("contacts", user.organizationId, contactId),
        dealLabel = related("deals", user.organizationId, dealId);
      const participantIds = Array.isArray(body.participantIds)
        ? [
            ...new Set(
              body.participantIds
                .map((value) => optionalText(value, 100))
                .filter((value): value is string => Boolean(value)),
            ),
          ]
        : [];
      if (participantIds.length > 50)
        throw new ActivityError(
          400,
          "VALIDATION",
          "Choose at most 50 participants.",
        );
      const participants = participantIds.map((id) => ({
        id,
        name: related("contacts", user.organizationId, id)!,
      }));
      const creator = database
        .prepare("SELECT display_name name FROM users WHERE id=?")
        .get(user.userId) as Row;
      const followUp =
        body.followUp && typeof body.followUp === "object"
          ? (body.followUp as Record<string, unknown>)
          : null;
      let task: {
        id: string;
        title: string;
        dueAt: string;
        assigneeId: string;
        priority: string;
      } | null = null;
      if (followUp) {
        const priority = optionalText(followUp.priority, 20) ?? "normal";
        if (!priorities.has(priority))
          throw new ActivityError(
            400,
            "VALIDATION",
            "Choose a valid follow-up priority.",
          );
        const assigneeId = requiredText(
          followUp.assigneeId,
          "Follow-up assignee",
          100,
        );
        if (
          !database
            .prepare(
              "SELECT 1 FROM memberships WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
            )
            .get(user.organizationId, assigneeId)
        )
          throw new ActivityError(
            400,
            "VALIDATION",
            "Choose an active assignee in this organization.",
          );
        task = {
          id: randomUUID(),
          title: requiredText(followUp.title, "Follow-up title", 200),
          dueAt: utc(followUp.dueAt, "Follow-up due time"),
          assigneeId,
          priority,
        };
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        if (task)
          database
            .prepare(
              "INSERT INTO tasks(id,organization_id,title,description,assignee_id,due_at,priority,status,company_id,contact_id,deal_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              task.id,
              user.organizationId,
              task.title,
              `Follow-up for: ${subject}`,
              task.assigneeId,
              task.dueAt,
              task.priority,
              "open",
              companyId,
              contactId,
              dealId,
              now,
              now,
            );
        database
          .prepare(
            "INSERT INTO activities(id,organization_id,type,subject,body,occurred_at,creator_id,creator_name_snapshot,company_id,company_name_snapshot,contact_id,contact_name_snapshot,deal_id,deal_name_snapshot,follow_up_task_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            user.organizationId,
            type,
            subject,
            narrative,
            occurredAt,
            user.userId,
            String(creator.name),
            companyId,
            companyLabel,
            contactId,
            contactLabel,
            dealId,
            dealLabel,
            task?.id ?? null,
            now,
            now,
          );
        const insertParticipant = database.prepare(
          "INSERT INTO activity_participants(organization_id,activity_id,contact_id,display_name_snapshot) VALUES (?,?,?,?)",
        );
        for (const participant of participants)
          insertParticipant.run(
            user.organizationId,
            id,
            participant.id,
            participant.name,
          );
        audit.run(
          randomUUID(),
          user.organizationId,
          user.userId,
          "activity.created",
          "activity",
          id,
          String(response.locals.requestId),
          JSON.stringify({ type, subject, followUpTaskId: task?.id ?? null }),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(201).json({
        ...json(find(user.organizationId, id)!),
        participants,
        followUpTask: task,
      });
    } catch (error) {
      send(error, response);
    }
  });

  router.put("/:id", async (request, response) => {
    try {
      const user = await mutation(request),
        existing = find(user.organizationId, request.params.id);
      if (!existing)
        throw new ActivityError(
          404,
          "NOT_FOUND",
          "The requested activity was not found.",
        );
      if (user.role !== "owner" && String(existing.creator_id) !== user.userId)
        throw new AuthError(
          "forbidden",
          "Only the creator or an owner can correct this activity.",
        );
      const version = Number((request.body as Record<string, unknown>).version);
      if (!Number.isInteger(version))
        throw new ActivityError(
          400,
          "VALIDATION",
          "The current activity version is required.",
        );
      const subject = requiredText(
          (request.body as Record<string, unknown>).subject,
          "Subject",
          200,
        ),
        body =
          optionalText((request.body as Record<string, unknown>).body, 10000) ??
          "",
        now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database
          .prepare(
            "UPDATE activities SET subject=?,body=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?",
          )
          .run(
            subject,
            body,
            now,
            user.organizationId,
            request.params.id,
            version,
          );
        if (result.changes !== 1)
          throw new ActivityError(
            409,
            "CONFLICT",
            "This activity changed while you were editing. Reload and try again.",
          );
        audit.run(
          randomUUID(),
          user.organizationId,
          user.userId,
          "activity.corrected",
          "activity",
          request.params.id,
          String(response.locals.requestId),
          JSON.stringify({ changed: ["subject", "body"] }),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json(json(find(user.organizationId, request.params.id)!));
    } catch (error) {
      send(error, response);
    }
  });
  router.delete("/:id", async (request, response) => {
    try {
      const user = await mutation(request),
        existing = find(user.organizationId, request.params.id);
      if (!existing)
        throw new ActivityError(
          404,
          "NOT_FOUND",
          "The requested activity was not found.",
        );
      if (user.role !== "owner" && String(existing.creator_id) !== user.userId)
        throw new AuthError(
          "forbidden",
          "Only the creator or an owner can delete this activity.",
        );
      const version = Number(request.query.version);
      if (!Number.isInteger(version))
        throw new ActivityError(
          400,
          "VALIDATION",
          "The current activity version is required.",
        );
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database
          .prepare(
            "DELETE FROM activities WHERE organization_id=? AND id=? AND version=?",
          )
          .run(user.organizationId, request.params.id, version);
        if (result.changes !== 1)
          throw new ActivityError(
            409,
            "CONFLICT",
            "This activity changed. Reload it before deleting.",
          );
        audit.run(
          randomUUID(),
          user.organizationId,
          user.userId,
          "activity.deleted",
          "activity",
          request.params.id,
          String(response.locals.requestId),
          JSON.stringify({ subject: String(existing.subject) }),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(204).end();
    } catch (error) {
      send(error, response);
    }
  });
  return router;
}
