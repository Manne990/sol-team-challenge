import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../../auth/http.js";
import { AuthError, AuthService } from "../../auth/service.js";
import { SqliteAuthRepository } from "../../auth/sqlite-repository.js";
import type { Principal } from "../../auth/types.js";

type Row = Record<string, unknown>;
type ContactInput = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  ownerMembershipId: string | null;
  status: "active" | "inactive" | "do_not_contact";
  tags: string[];
  communicationPreference: "email" | "phone" | "none";
  companyId: string | null;
};

const text = (value: unknown, maximum: number, required = false) => {
  if (value === null || value === undefined || value === "") {
    if (required) throw validation("Complete the required contact fields.");
    return null;
  }
  if (typeof value !== "string")
    throw validation("Contact fields must be text.");
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum)
    throw validation("Check the contact field lengths and try again.");
  return normalized || null;
};
const validation = (message: string) => new AuthError("validation", message);

function parseInput(body: unknown): ContactInput {
  if (!body || typeof body !== "object")
    throw validation("Enter contact details.");
  const input = body as Record<string, unknown>;
  const firstName = text(input.firstName, 80, true)!;
  const lastName = text(input.lastName, 80, true)!;
  const rawEmail = text(input.email, 254);
  const email = rawEmail?.toLowerCase() ?? null;
  if (email && !/^\S+@\S+\.\S+$/u.test(email))
    throw validation("Enter a valid email address.");
  const status = input.status ?? "active";
  if (!(["active", "inactive", "do_not_contact"] as unknown[]).includes(status))
    throw validation("Choose a valid contact status.");
  const communicationPreference = input.communicationPreference ?? "email";
  if (
    !(["email", "phone", "none"] as unknown[]).includes(communicationPreference)
  )
    throw validation("Choose a valid communication preference.");
  if (
    !Array.isArray(input.tags) ||
    input.tags.some((tag) => typeof tag !== "string")
  )
    throw validation("Tags must be a list of text values.");
  const tags = [
    ...new Set(
      input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (tags.length > 20 || tags.some((tag) => tag.length > 40))
    throw validation("Use at most 20 tags of 40 characters each.");
  return {
    firstName,
    lastName,
    email,
    phone: text(input.phone, 50),
    jobTitle: text(input.jobTitle, 120),
    ownerMembershipId: text(input.ownerMembershipId, 100),
    status: status as ContactInput["status"],
    tags,
    communicationPreference:
      communicationPreference as ContactInput["communicationPreference"],
    companyId: text(input.companyId, 100),
  };
}

const parseTags = (value: unknown) => {
  try {
    const tags = JSON.parse(String(value));
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
};

const contactJson = (row: Row) => ({
  id: String(row.id),
  firstName: String(row.first_name),
  lastName: String(row.last_name),
  name: `${String(row.first_name)} ${String(row.last_name)}`,
  email: row.email === null ? null : String(row.email),
  phone: row.phone === null ? null : String(row.phone),
  jobTitle: row.job_title === null ? null : String(row.job_title),
  status: String(row.status),
  tags: parseTags(row.tags_json),
  communicationPreference: String(row.communication_preference),
  company: row.company_id
    ? { id: String(row.company_id), name: String(row.company_name) }
    : null,
  owner: row.owner_id
    ? {
        id: String(row.owner_id),
        name: String(row.owner_name ?? ""),
      }
    : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  archivedAt: row.archived_at === null ? null : String(row.archived_at),
  version: Number(row.version),
});

const selectContact = `SELECT c.*,co.name company_name,
  u.display_name owner_name
  FROM contacts c LEFT JOIN companies co ON co.id=c.company_id AND co.organization_id=c.organization_id
  LEFT JOIN memberships m ON m.user_id=c.owner_id AND m.organization_id=c.organization_id
  LEFT JOIN users u ON u.id=m.user_id`;

export function contactsRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router();
  const auth = new AuthService(new SqliteAuthRepository(database));
  const authenticate = async (request: Request) =>
    auth.authenticate(readSessionCookie(request.headers.cookie));
  const mutable = async (request: Request) => {
    const user = await authenticate(request);
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
  const existing = (organizationId: string, id: string) =>
    database
      .prepare(`${selectContact} WHERE c.organization_id=? AND c.id=?`)
      .get(organizationId, id) as Row | undefined;
  const verifyRelations = (user: Principal, input: ContactInput) => {
    if (
      input.companyId &&
      !database
        .prepare("SELECT 1 FROM companies WHERE id=? AND organization_id=?")
        .get(input.companyId, user.organizationId)
    )
      throw new AuthError(
        "unauthenticated",
        "The requested record was not found.",
      );
    if (
      input.ownerMembershipId &&
      !database
        .prepare(
          "SELECT 1 FROM memberships WHERE user_id=? AND organization_id=? AND revoked_at IS NULL",
        )
        .get(input.ownerMembershipId, user.organizationId)
    )
      throw validation("Choose an active owner from this organization.");
  };
  const duplicateWarnings = (
    organizationId: string,
    email: string | null,
    exceptId?: string,
  ) => {
    if (!email) return [];
    const rows = database
      .prepare(
        `SELECT id,first_name,last_name,email FROM contacts
      WHERE organization_id=? AND email=? COLLATE NOCASE AND archived_at IS NULL AND id<>?
      ORDER BY last_name,first_name,id`,
      )
      .all(organizationId, email, exceptId ?? "") as Row[];
    return rows.map((row) => ({
      code: "EMAIL_MATCH",
      contactId: String(row.id),
      message: `${String(row.first_name)} ${String(row.last_name)} already uses ${String(row.email).toLowerCase()}.`,
    }));
  };
  const audit = (
    user: Principal,
    action: string,
    id: string,
    summary: object,
    now: string,
  ) =>
    database
      .prepare(
        `INSERT INTO audit_events
      (id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        user.organizationId,
        user.userId,
        action,
        "contact",
        id,
        randomUUID(),
        JSON.stringify(summary),
        now,
      );

  router.get("/", async (request, response, next) => {
    try {
      const user = await authenticate(request);
      const page = Math.max(
        1,
        Number.parseInt(String(request.query.page ?? "1"), 10) || 1,
      );
      const pageSize = Math.min(
        100,
        Math.max(
          1,
          Number.parseInt(String(request.query.pageSize ?? "25"), 10) || 25,
        ),
      );
      const conditions = ["c.organization_id=?"];
      const parameters: SQLInputValue[] = [user.organizationId];
      if (request.query.archived !== "true")
        conditions.push("c.archived_at IS NULL");
      for (const [query, column] of [
        ["companyId", "c.company_id"],
        ["ownerId", "c.owner_id"],
        ["status", "c.status"],
      ] as const) {
        if (typeof request.query[query] === "string" && request.query[query]) {
          conditions.push(`${column}=?`);
          parameters.push(request.query[query]);
        }
      }
      if (typeof request.query.tag === "string" && request.query.tag) {
        conditions.push(
          "EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE lower(value)=lower(?))",
        );
        parameters.push(request.query.tag);
      }
      if (typeof request.query.q === "string" && request.query.q.trim()) {
        conditions.push(
          "(c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')",
        );
        const pattern = `%${request.query.q.trim().replace(/[\\%_]/gu, "\\$&")}%`;
        parameters.push(pattern, pattern, pattern);
      }
      const where = conditions.join(" AND ");
      const total = Number(
        (
          database
            .prepare(`SELECT count(*) count FROM contacts c WHERE ${where}`)
            .get(...parameters) as Row
        ).count,
      );
      const sortColumns: Record<string, string> = {
        name: "c.last_name",
        firstName: "c.first_name",
        email: "c.email",
        status: "c.status",
        updatedAt: "c.updated_at",
      };
      const sort = sortColumns[String(request.query.sort)] ?? "c.last_name";
      const direction = request.query.direction === "desc" ? "DESC" : "ASC";
      const rows = database
        .prepare(
          `${selectContact} WHERE ${where} ORDER BY ${sort} ${direction},c.first_name ${direction},c.id ${direction} LIMIT ? OFFSET ?`,
        )
        .all(...parameters, pageSize, (page - 1) * pageSize) as Row[];
      response.json({
        contacts: rows.map(contactJson),
        pagination: {
          page,
          pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const user = await mutable(request);
      const input = parseInput(request.body);
      verifyRelations(user, input);
      const now = new Date().toISOString();
      const id = randomUUID();
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            `INSERT INTO contacts
          (id,organization_id,company_id,first_name,last_name,email,phone,job_title,owner_id,status,tags_json,communication_preference,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            user.organizationId,
            input.companyId,
            input.firstName,
            input.lastName,
            input.email,
            input.phone,
            input.jobTitle,
            input.ownerMembershipId,
            input.status,
            JSON.stringify(input.tags),
            input.communicationPreference,
            now,
            now,
          );
        audit(
          user,
          "contact.created",
          id,
          { fields: Object.keys(input), emailNormalized: Boolean(input.email) },
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(201).json({
        contact: contactJson(existing(user.organizationId, id)!),
        warnings: duplicateWarnings(user.organizationId, input.email, id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:contactId", async (request, response, next) => {
    try {
      const user = await authenticate(request);
      const id = String(request.params.contactId);
      const row = existing(user.organizationId, id);
      if (!row)
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "Contact not found." },
        });
      const related = (sql: string) =>
        database.prepare(sql).all(user.organizationId, id) as Row[];
      const activities = related(
        "SELECT id,type,subject,body,occurred_at occurredAt,creator_name_snapshot creatorLabel FROM activities WHERE organization_id=? AND contact_id=? ORDER BY occurred_at DESC,id DESC LIMIT 50",
      );
      const deals = related(
        "SELECT d.id,d.name,d.amount_minor amountMinor,d.currency,d.status,s.name stage FROM deal_contacts dc JOIN deals d ON d.id=dc.deal_id AND d.organization_id=dc.organization_id JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id WHERE dc.organization_id=? AND dc.contact_id=? ORDER BY d.updated_at DESC,d.id",
      );
      const tasks = related(
        "SELECT id,title,due_at dueAt,priority,status,completed_at completedAt FROM tasks WHERE organization_id=? AND contact_id=? AND archived_at IS NULL ORDER BY due_at,id",
      );
      const history = related(
        "SELECT id,action,summary_json summaryJson,occurred_at createdAt FROM audit_events WHERE organization_id=? AND entity_type='contact' AND entity_id=? ORDER BY occurred_at DESC,id DESC",
      ).map((event) => ({
        ...event,
        summary: JSON.parse(String(event.summaryJson)),
        summaryJson: undefined,
      }));
      response.json({
        contact: contactJson(row),
        activities,
        deals,
        tasks,
        history,
        warnings: duplicateWarnings(
          user.organizationId,
          row.email === null ? null : String(row.email),
          id,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/:contactId", async (request, response, next) => {
    try {
      const user = await mutable(request);
      const id = String(request.params.contactId);
      const before = existing(user.organizationId, id);
      if (!before)
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "Contact not found." },
        });
      const input = parseInput(request.body);
      verifyRelations(user, input);
      const version = Number((request.body as Row).version);
      if (!Number.isInteger(version) || version !== Number(before.version))
        return response.status(409).json({
          error: {
            code: "EDIT_CONFLICT",
            message:
              "This contact changed since you opened it. Reload and try again.",
          },
          contact: contactJson(before),
        });
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            `UPDATE contacts SET company_id=?,first_name=?,last_name=?,email=?,phone=?,job_title=?,owner_id=?,status=?,tags_json=?,communication_preference=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?`,
          )
          .run(
            input.companyId,
            input.firstName,
            input.lastName,
            input.email,
            input.phone,
            input.jobTitle,
            input.ownerMembershipId,
            input.status,
            JSON.stringify(input.tags),
            input.communicationPreference,
            now,
            id,
            user.organizationId,
          );
        audit(
          user,
          "contact.updated",
          id,
          {
            changed: Object.keys(input).filter(
              (key) =>
                JSON.stringify((input as unknown as Row)[key]) !==
                JSON.stringify(
                  before[
                    key.replace(
                      /[A-Z]/gu,
                      (letter) => `_${letter.toLowerCase()}`,
                    )
                  ],
                ),
            ),
          },
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json({
        contact: contactJson(existing(user.organizationId, id)!),
        warnings: duplicateWarnings(user.organizationId, input.email, id),
      });
    } catch (error) {
      next(error);
    }
  });

  const archiveAction =
    (restore: boolean) =>
    async (
      request: Request,
      response: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      try {
        const user = await mutable(request);
        const id = String(request.params.contactId);
        if (!existing(user.organizationId, id))
          return response.status(404).json({
            error: { code: "NOT_FOUND", message: "Contact not found." },
          });
        if (
          restore &&
          database
            .prepare(
              "SELECT 1 FROM merge_redirects WHERE organization_id=? AND entity_type='contact' AND retired_id=?",
            )
            .get(user.organizationId, id)
        )
          return response.status(409).json({
            error: {
              code: "MERGED_RECORD",
              message:
                "This contact was merged and cannot be restored. Follow its merge redirect instead.",
            },
          });
        const now = new Date().toISOString();
        database.exec("BEGIN IMMEDIATE");
        try {
          database
            .prepare(
              `UPDATE contacts SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?`,
            )
            .run(restore ? null : now, now, id, user.organizationId);
          audit(
            user,
            restore ? "contact.restored" : "contact.archived",
            id,
            {},
            now,
          );
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        response.json({
          contact: contactJson(existing(user.organizationId, id)!),
        });
      } catch (error) {
        next(error);
      }
    };
  router.delete("/:contactId", archiveAction(false));
  router.post("/:contactId/restore", archiveAction(true));
  return router;
}
