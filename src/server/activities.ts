import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const TYPES = new Set(["call", "email", "meeting", "note", "status_change"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const invalid = (message: string) =>
  new AuthError(400, "VALIDATION_ERROR", message);
const stringValue = (
  value: unknown,
  field: string,
  maximum: number,
  required = false,
) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string") throw invalid(`${field} must be text.`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum)
    throw invalid(`Check ${field.toLowerCase()} and try again.`);
  return normalized || null;
};
const isoDate = (value: unknown, field: string, required = false) => {
  const text = stringValue(value, field, 50, required);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime()))
    throw invalid(`${field} must be a valid date and time.`);
  return date.toISOString();
};
const parseJson = (value: unknown, fallback: unknown) => {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};

function createInput(body: unknown) {
  if (!body || typeof body !== "object")
    throw invalid("Enter activity details.");
  const data = body as Row;
  const type = stringValue(data.type, "Type", 30, true)!;
  if (!TYPES.has(type)) throw invalid("Choose a valid activity type.");
  if (!Array.isArray(data.participantIds))
    throw invalid("Participants must be a list.");
  const participantIds = [
    ...new Set(
      data.participantIds.map((id) =>
        stringValue(id, "Participant", 100, true)!,
      ),
    ),
  ];
  if (participantIds.length > 50)
    throw invalid("Choose no more than 50 participants.");
  const followUp = data.followUp;
  if (
    followUp !== undefined &&
    followUp !== null &&
    typeof followUp !== "object"
  )
    throw invalid("Check the follow-up details.");
  const task = followUp as Row | null | undefined;
  const priority = task
    ? stringValue(task.priority ?? "normal", "Priority", 20, true)!
    : null;
  if (priority && !PRIORITIES.has(priority))
    throw invalid("Choose a valid follow-up priority.");
  return {
    type,
    subject: stringValue(data.subject, "Subject", 200, true)!,
    body: stringValue(data.body, "Summary", 10_000) ?? "",
    occurredAt: isoDate(data.occurredAt, "Occurred time", true)!,
    companyId: stringValue(data.companyId, "Company", 100),
    contactId: stringValue(data.contactId, "Contact", 100),
    dealId: stringValue(data.dealId, "Deal", 100),
    participantIds,
    followUp: task
      ? {
          title: stringValue(task.title, "Follow-up title", 200, true)!,
          description:
            stringValue(task.description, "Follow-up description", 5_000) ?? "",
          assigneeMembershipId: stringValue(
            task.assigneeMembershipId,
            "Assignee",
            100,
            true,
          )!,
          dueAt: isoDate(task.dueAt, "Due time"),
          priority: priority!,
        }
      : null,
  };
}

const activityJson = (row: Row) => ({
  id: String(row.id),
  type: String(row.type),
  subject: String(row.subject),
  body: String(row.body),
  occurredAt: String(row.occurred_at),
  creator: {
    id: String(row.creator_membership_id),
    name: String(row.creator_label),
  },
  companyId: row.company_id === null ? null : String(row.company_id),
  contactId: row.contact_id === null ? null : String(row.contact_id),
  dealId: row.deal_id === null ? null : String(row.deal_id),
  followUpTaskId:
    row.follow_up_task_id === null ? null : String(row.follow_up_task_id),
  relatedLabels: parseJson(row.related_label_json, {}),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  version: Number(row.version),
});

export class ActivityStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(organizationId: string, query: Row) {
    const page = Math.max(
      1,
      Number.parseInt(String(query.page ?? "1"), 10) || 1,
    );
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(String(query.pageSize ?? "25"), 10) || 25),
    );
    const conditions = ["organization_id=?"];
    const parameters: unknown[] = [organizationId];
    for (const [key, column] of [
      ["type", "type"],
      ["creatorId", "creator_membership_id"],
      ["companyId", "company_id"],
      ["contactId", "contact_id"],
      ["dealId", "deal_id"],
    ] as const) {
      if (typeof query[key] === "string" && query[key]) {
        if (key === "type" && !TYPES.has(String(query[key])))
          throw invalid("Choose a valid activity type.");
        conditions.push(`${column}=?`);
        parameters.push(query[key]);
      }
    }
    for (const [key, operator] of [
      ["from", ">="],
      ["to", "<="],
    ] as const) {
      if (query[key]) {
        conditions.push(`occurred_at ${operator} ?`);
        parameters.push(
          isoDate(query[key], key === "from" ? "From date" : "To date", true),
        );
      }
    }
    const where = conditions.join(" AND ");
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) count FROM activities WHERE ${where}`)
          .get(...parameters) as Row
      ).count,
    );
    const rows = this.db
      .prepare(
        `SELECT * FROM activities WHERE ${where} ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, pageSize, (page - 1) * pageSize) as Row[];
    return {
      activities: rows.map(activityJson),
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  detail(organizationId: string, id: string) {
    const row = this.db
      .prepare("SELECT * FROM activities WHERE organization_id=? AND id=?")
      .get(organizationId, id) as Row | undefined;
    if (!row) return undefined;
    const participants = this.db
      .prepare(
        `SELECT c.id,c.first_name,c.last_name,c.email FROM activity_participants p
       JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id
       WHERE p.organization_id=? AND p.activity_id=? ORDER BY c.last_name,c.first_name,c.id`,
      )
      .all(organizationId, id) as Row[];
    return {
      ...activityJson(row),
      participants: participants.map((item) => ({
        id: String(item.id),
        name: `${String(item.first_name)} ${String(item.last_name)}`,
        email: item.email === null ? null : String(item.email),
      })),
    };
  }

  create(actor: AuthenticatedUser, body: unknown) {
    const data = createInput(body);
    const labels: Record<string, string> = {};
    for (const relation of [
      ["company", "companies", data.companyId, "name"],
      ["contact", "contacts", data.contactId, "first_name || ' ' || last_name"],
      ["deal", "deals", data.dealId, "name"],
    ] as const) {
      if (!relation[2]) continue;
      const row = this.db
        .prepare(
          `SELECT ${relation[3]} label FROM ${relation[1]} WHERE id=? AND organization_id=?`,
        )
        .get(relation[2], actor.organization.id) as Row | undefined;
      if (!row)
        throw new AuthError(
          403,
          "FORBIDDEN",
          "A related record is unavailable.",
        );
      labels[relation[0]] = String(row.label);
    }
    for (const participantId of data.participantIds) {
      if (
        !this.db
          .prepare("SELECT 1 FROM contacts WHERE id=? AND organization_id=?")
          .get(participantId, actor.organization.id)
      )
        throw new AuthError(403, "FORBIDDEN", "A participant is unavailable.");
    }
    if (
      data.followUp &&
      !this.db
        .prepare(
          "SELECT 1 FROM memberships WHERE id=? AND organization_id=? AND status='active'",
        )
        .get(data.followUp.assigneeMembershipId, actor.organization.id)
    )
      throw invalid("Choose an active assignee in this organization.");

    const id = randomUUID();
    const taskId = data.followUp ? randomUUID() : null;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (data.followUp)
        this.db
          .prepare(
            `INSERT INTO tasks(id,organization_id,title,description,assignee_membership_id,due_at,priority,status,company_id,contact_id,deal_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,'open',?,?,?,?,?)`,
          )
          .run(
            taskId,
            actor.organization.id,
            data.followUp.title,
            data.followUp.description,
            data.followUp.assigneeMembershipId,
            data.followUp.dueAt,
            data.followUp.priority,
            data.companyId,
            data.contactId,
            data.dealId,
            now,
            now,
          );
      this.db
        .prepare(
          `INSERT INTO activities(id,organization_id,type,subject,body,occurred_at,creator_membership_id,creator_label,company_id,contact_id,deal_id,follow_up_task_id,related_label_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          actor.organization.id,
          data.type,
          data.subject,
          data.body,
          data.occurredAt,
          actor.membershipId,
          actor.name,
          data.companyId,
          data.contactId,
          data.dealId,
          taskId,
          JSON.stringify(labels),
          now,
          now,
        );
      const participant = this.db.prepare(
        "INSERT INTO activity_participants(organization_id,activity_id,contact_id) VALUES(?,?,?)",
      );
      for (const participantId of data.participantIds)
        participant.run(actor.organization.id, id, participantId);
      this.audit(
        actor,
        "activity.created",
        id,
        { type: data.type, followUpTaskId: taskId },
        now,
      );
      if (taskId)
        this.audit(
          actor,
          "task.created",
          taskId,
          { sourceActivityId: id },
          now,
          "task",
        );
      this.db.exec("COMMIT");
      return this.detail(actor.organization.id, id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  update(actor: AuthenticatedUser, id: string, body: unknown) {
    const current = this.detail(actor.organization.id, id);
    if (!current) throw new AuthError(404, "NOT_FOUND", "Activity not found.");
    if (actor.role !== "owner" && current.creator.id !== actor.membershipId)
      throw new AuthError(
        403,
        "FORBIDDEN",
        "Only the creator or an owner can edit this activity.",
      );
    if (!body || typeof body !== "object")
      throw invalid("Enter activity details.");
    const data = body as Row;
    const version = Number(data.version);
    if (!Number.isInteger(version))
      throw invalid("Refresh the activity before saving.");
    const subject = stringValue(data.subject, "Subject", 200, true)!;
    const summary = stringValue(data.body, "Summary", 10_000) ?? "";
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "UPDATE activities SET subject=?,body=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
        )
        .run(subject, summary, now, id, actor.organization.id, version) as Row;
      if (Number(result.changes) === 0)
        throw new AuthError(
          409,
          "EDIT_CONFLICT",
          "This activity changed. Refresh and review the latest version.",
        );
      this.audit(
        actor,
        "activity.updated",
        id,
        { fields: ["subject", "body"] },
        now,
      );
      this.db.exec("COMMIT");
      return this.detail(actor.organization.id, id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  delete(actor: AuthenticatedUser, id: string, body: unknown) {
    const current = this.detail(actor.organization.id, id);
    if (!current) throw new AuthError(404, "NOT_FOUND", "Activity not found.");
    if (actor.role !== "owner" && current.creator.id !== actor.membershipId)
      throw new AuthError(
        403,
        "FORBIDDEN",
        "Only the creator or an owner can delete this activity.",
      );
    const version = Number((body as Row | null)?.version);
    if (!Number.isInteger(version))
      throw invalid("Refresh the activity before deleting it.");
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "DELETE FROM activity_participants WHERE organization_id=? AND activity_id=?",
        )
        .run(actor.organization.id, id);
      const result = this.db
        .prepare(
          "DELETE FROM activities WHERE organization_id=? AND id=? AND version=?",
        )
        .run(actor.organization.id, id, version) as Row;
      if (Number(result.changes) === 0)
        throw new AuthError(
          409,
          "EDIT_CONFLICT",
          "This activity changed. Refresh and review the latest version.",
        );
      this.audit(
        actor,
        "activity.deleted",
        id,
        { subject: current.subject },
        now,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private audit(
    actor: AuthenticatedUser,
    action: string,
    id: string,
    summary: object,
    now: string,
    entityType = "activity",
  ) {
    this.db
      .prepare(
        `INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        actor.organization.id,
        actor.membershipId,
        action,
        entityType,
        id,
        randomUUID(),
        JSON.stringify(summary),
        now,
      );
  }
}

export function activitiesRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const store = new ActivityStore(db);
  const actor = async (request: Request, mutable = false) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      mutable ? ["owner", "member"] : ["owner", "member", "viewer"],
    );
  router.get("/", async (request, response, next) => {
    try {
      response.json(
        store.list(
          (await actor(request)).organization.id,
          request.query as Row,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id", async (request, response, next) => {
    try {
      const user = await actor(request);
      const activity = store.detail(
        user.organization.id,
        String(request.params.id),
      );
      if (!activity)
        throw new AuthError(404, "NOT_FOUND", "Activity not found.");
      response.json({ activity });
    } catch (error) {
      next(error);
    }
  });
  router.post("/", async (request, response, next) => {
    try {
      response.status(201).json({
        activity: store.create(await actor(request, true), request.body),
      });
    } catch (error) {
      next(error);
    }
  });
  router.put("/:id", async (request, response, next) => {
    try {
      response.json({
        activity: store.update(
          await actor(request, true),
          String(request.params.id),
          request.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.delete("/:id", async (request, response, next) => {
    try {
      store.delete(
        await actor(request, true),
        String(request.params.id),
        request.body,
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
