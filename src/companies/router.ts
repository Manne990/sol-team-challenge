import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
import type { Principal } from "../auth/types.js";

type Row = Record<string, unknown>;
type CompanyInput = {
  name?: unknown;
  organizationNumber?: unknown;
  externalReference?: unknown;
  website?: unknown;
  phone?: unknown;
  industry?: unknown;
  size?: unknown;
  address?: unknown;
  lifecycleStatus?: unknown;
  ownerId?: unknown;
  tags?: unknown;
  description?: unknown;
  version?: unknown;
};
const lifecycles = new Set([
  "lead",
  "prospect",
  "customer",
  "former_customer",
  "partner",
]);
const sorts: Record<string, string> = {
  name: "c.name",
  updated: "c.updated_at",
  industry: "c.industry",
  lifecycle: "c.lifecycle_status",
};

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim().length <= maximum
    ? value.trim()
    : "";
}
function optional(value: unknown, maximum = 500) {
  const valueText = text(value, maximum);
  return valueText || null;
}
function input(body: CompanyInput) {
  const name = text(body.name, 160);
  const lifecycleStatus = text(body.lifecycleStatus, 40) || "prospect";
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((tag) => text(tag, 50)).filter(Boolean))].slice(
        0,
        20,
      )
    : [];
  if (!name)
    throw new CompanyError(
      400,
      "VALIDATION",
      "Company name is required and must be 160 characters or fewer.",
    );
  if (!lifecycles.has(lifecycleStatus))
    throw new CompanyError(
      400,
      "VALIDATION",
      "Choose a valid lifecycle status.",
    );
  return {
    name,
    organizationNumber: optional(body.organizationNumber, 100),
    externalReference: optional(body.externalReference, 100),
    website: optional(body.website, 300),
    phone: optional(body.phone, 80),
    industry: optional(body.industry, 100),
    size: optional(body.size, 80),
    address: optional(body.address, 500),
    lifecycleStatus,
    ownerId: optional(body.ownerId, 100),
    tags,
    description: text(body.description, 5000),
  };
}
class CompanyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function company(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    organizationNumber: row.organization_number
      ? String(row.organization_number)
      : null,
    externalReference: row.external_reference
      ? String(row.external_reference)
      : null,
    website: row.website ? String(row.website) : null,
    phone: row.phone ? String(row.phone) : null,
    industry: row.industry ? String(row.industry) : null,
    size: row.size ? String(row.size) : null,
    address: row.address ? String(row.address) : null,
    lifecycleStatus: String(row.lifecycle_status),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    ownerName: row.owner_name ? String(row.owner_name) : null,
    tags: JSON.parse(String(row.tags_json)) as string[],
    description: String(row.description),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
  };
}
function sendError(error: unknown, response: Response) {
  if (error instanceof CompanyError)
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(error.code === "forbidden" ? 403 : 401)
      .json({ error: { code: error.code, message: error.message } });
  else if (
    error instanceof Error &&
    /UNIQUE constraint failed/.test(error.message)
  )
    response.status(409).json({
      error: {
        code: "DUPLICATE_COMPANY",
        message:
          "A company with that organization number or external reference already exists.",
      },
    });
  else throw error;
}

export function createCompaniesRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router();
  const auth = new AuthService(new SqliteAuthRepository(database));
  const principal = async (request: Request) =>
    auth.authenticate(readSessionCookie(request.header("cookie")));
  const mutation = async (request: Request) => {
    const person = await principal(request);
    auth.requireMutation(person);
    if (
      !requestHasTrustedOrigin(
        request.header("origin"),
        request.header("host"),
        secureCookies,
      )
    )
      throw new AuthError("forbidden", "The request origin is not allowed.");
    return person;
  };
  const locate = (id: string, person: Principal) =>
    database
      .prepare(
        "SELECT c.*,u.display_name owner_name FROM companies c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=? AND c.organization_id=?",
      )
      .get(id, person.organizationId) as Row | undefined;
  const audit = database.prepare(
    "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );

  router.get("/", async (request, response) => {
    try {
      const person = await principal(request);
      const page = Math.max(1, Number(request.query.page) || 1),
        pageSize = Math.min(
          100,
          Math.max(1, Number(request.query.pageSize) || 20),
        );
      const where = ["c.organization_id=?"],
        values: SQLInputValue[] = [person.organizationId];
      if (request.query.archived !== "true")
        where.push("c.archived_at IS NULL");
      for (const [query, column] of [
        ["lifecycle", "c.lifecycle_status"],
        ["owner", "c.owner_id"],
        ["industry", "c.industry"],
        ["size", "c.size"],
      ] as const) {
        if (typeof request.query[query] === "string" && request.query[query]) {
          where.push(`${column}=?`);
          values.push(String(request.query[query]));
        }
      }
      if (typeof request.query.tag === "string" && request.query.tag) {
        where.push(
          "EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE value=?)",
        );
        values.push(String(request.query.tag));
      }
      if (typeof request.query.q === "string" && request.query.q.trim()) {
        where.push(
          "(c.name LIKE ? ESCAPE '\\' OR c.organization_number LIKE ? ESCAPE '\\' OR c.external_reference LIKE ? ESCAPE '\\')",
        );
        const q = `%${request.query.q.trim().replace(/[\\%_]/g, "\\$&")}%`;
        values.push(q, q, q);
      }
      const clause = where.join(" AND ");
      const total = Number(
        (
          database
            .prepare(`SELECT count(*) total FROM companies c WHERE ${clause}`)
            .get(...values) as Row
        ).total,
      );
      const sort = sorts[String(request.query.sort)] ?? sorts.name,
        direction = request.query.direction === "desc" ? "DESC" : "ASC";
      const rows = database
        .prepare(
          `SELECT c.*,u.display_name owner_name FROM companies c LEFT JOIN users u ON u.id=c.owner_id WHERE ${clause} ORDER BY ${sort} ${direction},c.id ${direction} LIMIT ? OFFSET ?`,
        )
        .all(...values, pageSize, (page - 1) * pageSize) as Row[];
      response.json({
        items: rows.map(company),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      sendError(error, response);
    }
  });
  router.get("/:id", async (request, response) => {
    try {
      const person = await principal(request);
      const row = locate(request.params.id, person);
      if (!row)
        throw new CompanyError(
          404,
          "NOT_FOUND",
          "The requested company was not found.",
        );
      const counts = database
        .prepare(
          "SELECT (SELECT count(*) FROM contacts WHERE organization_id=? AND company_id=?) contacts,(SELECT count(*) FROM activities WHERE organization_id=? AND company_id=?) activities,(SELECT count(*) FROM deals WHERE organization_id=? AND company_id=?) deals,(SELECT count(*) FROM tasks WHERE organization_id=? AND company_id=?) tasks",
        )
        .get(
          person.organizationId,
          request.params.id,
          person.organizationId,
          request.params.id,
          person.organizationId,
          request.params.id,
          person.organizationId,
          request.params.id,
        ) as Row;
      const history = database
        .prepare(
          "SELECT action,summary_json,occurred_at FROM audit_events WHERE organization_id=? AND entity_type='company' AND entity_id=? ORDER BY occurred_at DESC,id DESC LIMIT 25",
        )
        .all(person.organizationId, request.params.id) as Row[];
      const activities = database
        .prepare(
          "SELECT id,type,subject,body,occurred_at,creator_name_snapshot FROM activities WHERE organization_id=? AND company_id=? ORDER BY occurred_at DESC,id DESC LIMIT 50",
        )
        .all(person.organizationId, request.params.id) as Row[];
      response.json({
        ...company(row),
        related: {
          contacts: Number(counts.contacts),
          activities: Number(counts.activities),
          deals: Number(counts.deals),
          tasks: Number(counts.tasks),
        },
        history: history.map((x) => ({
          action: String(x.action),
          summary: JSON.parse(String(x.summary_json)),
          occurredAt: String(x.occurred_at),
        })),
        activities: activities.map((activity) => ({
          id: String(activity.id),
          type: String(activity.type),
          subject: String(activity.subject),
          body: String(activity.body),
          occurredAt: String(activity.occurred_at),
          creatorLabel: String(activity.creator_name_snapshot),
        })),
      });
    } catch (error) {
      sendError(error, response);
    }
  });
  router.post("/", async (request, response) => {
    try {
      const person = await mutation(request);
      const value = input(request.body as CompanyInput);
      if (value.ownerId) {
        const owner = database
          .prepare(
            "SELECT 1 FROM memberships WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
          )
          .get(person.organizationId, value.ownerId);
        if (!owner)
          throw new CompanyError(
            400,
            "VALIDATION",
            "Choose an active owner in this organization.",
          );
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address,lifecycle_status,owner_id,tags_json,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            person.organizationId,
            value.name,
            value.organizationNumber,
            value.externalReference,
            value.website,
            value.phone,
            value.industry,
            value.size,
            value.address,
            value.lifecycleStatus,
            value.ownerId,
            JSON.stringify(value.tags),
            value.description,
            now,
            now,
          );
        audit.run(
          randomUUID(),
          person.organizationId,
          person.userId,
          "company.created",
          "company",
          id,
          String(response.locals.requestId),
          JSON.stringify({ name: value.name }),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(201).json(company(locate(id, person)!));
    } catch (error) {
      sendError(error, response);
    }
  });
  router.put("/:id", async (request, response) => {
    try {
      const person = await mutation(request);
      const existing = locate(request.params.id, person);
      if (!existing)
        throw new CompanyError(
          404,
          "NOT_FOUND",
          "The requested company was not found.",
        );
      const value = input(request.body as CompanyInput),
        version = Number(request.body.version);
      if (!Number.isInteger(version))
        throw new CompanyError(
          400,
          "VALIDATION",
          "The record version is required.",
        );
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database
          .prepare(
            "UPDATE companies SET name=?,organization_number=?,external_reference=?,website=?,phone=?,industry=?,size=?,address=?,lifecycle_status=?,owner_id=?,tags_json=?,description=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(
            value.name,
            value.organizationNumber,
            value.externalReference,
            value.website,
            value.phone,
            value.industry,
            value.size,
            value.address,
            value.lifecycleStatus,
            value.ownerId,
            JSON.stringify(value.tags),
            value.description,
            now,
            request.params.id,
            person.organizationId,
            version,
          );
        if (result.changes !== 1)
          throw new CompanyError(
            409,
            "EDIT_CONFLICT",
            "This company changed since you opened it. Refresh and compare before saving.",
          );
        audit.run(
          randomUUID(),
          person.organizationId,
          person.userId,
          "company.updated",
          "company",
          request.params.id,
          String(response.locals.requestId),
          JSON.stringify({ fields: Object.keys(request.body) }),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json(company(locate(request.params.id, person)!));
    } catch (error) {
      sendError(error, response);
    }
  });
  router.post("/:id/:action", async (request, response) => {
    try {
      const person = await mutation(request);
      const action = request.params.action;
      if (action !== "archive" && action !== "restore")
        throw new CompanyError(
          404,
          "NOT_FOUND",
          "The requested action was not found.",
        );
      const row = locate(request.params.id, person);
      if (!row)
        throw new CompanyError(
          404,
          "NOT_FOUND",
          "The requested company was not found.",
        );
      const now = new Date().toISOString(),
        archived = action === "archive" ? now : null;
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "UPDATE companies SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
          )
          .run(archived, now, request.params.id, person.organizationId);
        audit.run(
          randomUUID(),
          person.organizationId,
          person.userId,
          `company.${action}d`,
          "company",
          request.params.id,
          String(response.locals.requestId),
          JSON.stringify({ name: String(row.name) }),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json(company(locate(request.params.id, person)!));
    } catch (error) {
      sendError(error, response);
    }
  });
  return router;
}
