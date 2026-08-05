import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const allowedSort = new Set([
  "name",
  "created_at",
  "updated_at",
  "industry",
  "size",
  "lifecycle_status",
]);
const lifecycle = new Set(["lead", "prospect", "customer", "inactive"]);
const text = (value: unknown, max: number, required = false) => {
  if (value == null && !required) return null;
  if (typeof value !== "string")
    throw new AuthError(
      400,
      "VALIDATION_ERROR",
      "Check the highlighted company fields.",
    );
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max)
    throw new AuthError(
      400,
      "VALIDATION_ERROR",
      "Check the highlighted company fields.",
    );
  return normalized || null;
};
function input(body: unknown) {
  const data = (body && typeof body === "object" ? body : {}) as Row;
  const status = text(data.lifecycleStatus, 30, true)!;
  if (!lifecycle.has(status))
    throw new AuthError(
      400,
      "VALIDATION_ERROR",
      "Choose a valid lifecycle status.",
    );
  const tags = Array.isArray(data.tags)
    ? [...new Set(data.tags.map((tag) => text(tag, 40, true)!))].slice(0, 20)
    : [];
  const website = text(data.website, 300);
  if (website) {
    try {
      const url = new URL(website);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Enter a valid HTTP or HTTPS website.",
      );
    }
  }
  return {
    name: text(data.name, 160, true)!,
    organizationNumber: text(data.organizationNumber, 80),
    externalReference: text(data.externalReference, 80),
    website,
    phone: text(data.phone, 60),
    industry: text(data.industry, 100),
    size: text(data.size, 40),
    address:
      typeof data.address === "object" && data.address ? data.address : {},
    lifecycleStatus: status,
    ownerMembershipId: text(data.ownerMembershipId, 100),
    tags,
    description: text(data.description, 5000) ?? "",
  };
}
const company = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  organizationNumber: row.organization_number,
  externalReference: row.external_reference,
  website: row.website,
  phone: row.phone,
  industry: row.industry,
  size: row.size,
  address: JSON.parse(String(row.address_json)),
  lifecycleStatus: row.lifecycle_status,
  ownerMembershipId: row.owner_membership_id,
  ownerName: row.owner_name ?? null,
  tags: JSON.parse(String(row.tags_json)),
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
  version: Number(row.version),
});

export class CompanyStore {
  constructor(private db: SqliteDatabase) {}
  list(org: string, query: Row) {
    const page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const clauses = ["c.organization_id=?"],
      args: unknown[] = [org];
    if (query.includeArchived !== "true") clauses.push("c.archived_at IS NULL");
    for (const [key, column] of [
      ["lifecycle", "c.lifecycle_status"],
      ["owner", "c.owner_membership_id"],
      ["industry", "c.industry"],
      ["size", "c.size"],
    ] as const)
      if (typeof query[key] === "string" && query[key]) {
        clauses.push(`${column}=?`);
        args.push(query[key]);
      }
    if (typeof query.tag === "string" && query.tag) {
      clauses.push(
        "EXISTS(SELECT 1 FROM json_each(c.tags_json) WHERE value=?)",
      );
      args.push(query.tag);
    }
    if (typeof query.q === "string" && query.q.trim()) {
      clauses.push(
        "(c.name LIKE ? OR c.organization_number LIKE ? OR c.external_reference LIKE ?)",
      );
      const q = `%${query.q.trim()}%`;
      args.push(q, q, q);
    }
    const where = clauses.join(" AND "),
      sort = allowedSort.has(String(query.sort)) ? String(query.sort) : "name",
      direction = query.order === "desc" ? "DESC" : "ASC";
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) total FROM companies c WHERE ${where}`)
          .get(...args) as Row
      ).total,
    );
    const rows = this.db
      .prepare(
        `SELECT c.*,trim(u.first_name||' '||u.last_name) owner_name FROM companies c LEFT JOIN memberships m ON m.id=c.owner_membership_id AND m.organization_id=c.organization_id LEFT JOIN users u ON u.id=m.user_id WHERE ${where} ORDER BY c.${sort} ${direction},c.id ${direction} LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as Row[];
    return {
      items: rows.map(company),
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
  detail(org: string, id: string) {
    const row = this.db
      .prepare(
        "SELECT c.*,trim(u.first_name||' '||u.last_name) owner_name FROM companies c LEFT JOIN memberships m ON m.id=c.owner_membership_id AND m.organization_id=c.organization_id LEFT JOIN users u ON u.id=m.user_id WHERE c.id=? AND c.organization_id=?",
      )
      .get(id, org) as Row | undefined;
    if (!row) return undefined;
    const related = (table: string) =>
      this.db
        .prepare(
          `SELECT count(*) count FROM ${table} WHERE company_id=? AND organization_id=?`,
        )
        .get(id, org) as Row;
    const history = this.db
      .prepare(
        "SELECT action,summary_json,created_at FROM audit_events WHERE organization_id=? AND entity_type='company' AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT 50",
      )
      .all(org, id) as Row[];
    return {
      ...company(row),
      related: {
        contacts: Number(related("contacts").count),
        activities: Number(related("activities").count),
        deals: Number(related("deals").count),
        tasks: Number(related("tasks").count),
      },
      history: history.map((x) => ({
        action: x.action,
        summary: JSON.parse(String(x.summary_json)),
        createdAt: x.created_at,
      })),
    };
  }
  write(
    actor: AuthenticatedUser,
    id: string | undefined,
    data: ReturnType<typeof input>,
    expected?: number,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString(),
        companyId = id ?? randomUUID();
      if (
        data.ownerMembershipId &&
        !this.db
          .prepare(
            "SELECT 1 FROM memberships WHERE id=? AND organization_id=? AND status='active'",
          )
          .get(data.ownerMembershipId, actor.organization.id)
      )
        throw new AuthError(
          400,
          "VALIDATION_ERROR",
          "Choose an active owner in your organization.",
        );
      if (id) {
        const before = this.detail(actor.organization.id, id);
        if (!before)
          throw new AuthError(404, "NOT_FOUND", "Company not found.");
        const result = this.db
          .prepare(
            "UPDATE companies SET name=?,organization_number=?,external_reference=?,website=?,phone=?,industry=?,size=?,address_json=?,lifecycle_status=?,owner_membership_id=?,tags_json=?,description=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(
            data.name,
            data.organizationNumber,
            data.externalReference,
            data.website,
            data.phone,
            data.industry,
            data.size,
            JSON.stringify(data.address),
            data.lifecycleStatus,
            data.ownerMembershipId,
            JSON.stringify(data.tags),
            data.description,
            now,
            id,
            actor.organization.id,
            expected,
          );
        if (Number((result as Row).changes) === 0)
          throw new AuthError(
            409,
            "EDIT_CONFLICT",
            "This company changed. Refresh and review the latest version.",
          );
        this.audit(actor, "company.updated", companyId, { version: expected });
      } else {
        this.db
          .prepare(
            "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address_json,lifecycle_status,owner_membership_id,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            companyId,
            actor.organization.id,
            data.name,
            data.organizationNumber,
            data.externalReference,
            data.website,
            data.phone,
            data.industry,
            data.size,
            JSON.stringify(data.address),
            data.lifecycleStatus,
            data.ownerMembershipId,
            JSON.stringify(data.tags),
            data.description,
            now,
            now,
          );
        this.audit(actor, "company.created", companyId, { name: data.name });
      }
      this.db.exec("COMMIT");
      return this.detail(actor.organization.id, companyId)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (String(error).includes("UNIQUE constraint failed"))
        throw new AuthError(
          409,
          "COMPANY_CONFLICT",
          "Organization number or external reference already belongs to another company.",
        );
      throw error;
    }
  }
  archive(actor: AuthenticatedUser, id: string, restore = false) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `UPDATE companies SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND archived_at IS ${restore ? "NOT " : ""}NULL`,
        )
        .run(restore ? null : now, now, id, actor.organization.id);
      if (Number((result as Row).changes) === 0)
        throw new AuthError(404, "NOT_FOUND", "Company not found.");
      this.audit(
        actor,
        restore ? "company.restored" : "company.archived",
        id,
        {},
      );
      this.db.exec("COMMIT");
      return this.detail(actor.organization.id, id)!;
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
  ) {
    this.db
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        actor.organization.id,
        actor.membershipId,
        action,
        "company",
        id,
        randomUUID(),
        JSON.stringify(summary),
        new Date().toISOString(),
      );
  }
}

export function companiesRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router(),
    store = new CompanyStore(db);
  const actor = async (request: Request, mutable = false) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      mutable ? ["owner", "member"] : ["owner", "member", "viewer"],
    );
  router.get("/", async (req, res, next) => {
    try {
      res.json(
        store.list((await actor(req)).organization.id, req.query as Row),
      );
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const user = await actor(req),
        item = store.detail(user.organization.id, String(req.params.id));
      if (!item) throw new AuthError(404, "NOT_FOUND", "Company not found.");
      res.json({ company: item });
    } catch (e) {
      next(e);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      res.status(201).json({
        company: store.write(
          await actor(req, true),
          undefined,
          input(req.body),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.patch("/:id", async (req, res, next) => {
    try {
      const version = Number((req.body as Row)?.version);
      if (!Number.isInteger(version))
        throw new AuthError(
          400,
          "VALIDATION_ERROR",
          "Refresh the company before saving.",
        );
      res.json({
        company: store.write(
          await actor(req, true),
          String(req.params.id),
          input(req.body),
          version,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post("/:id/archive", async (req, res, next) => {
    try {
      res.json({
        company: store.archive(await actor(req, true), String(req.params.id)),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post("/:id/restore", async (req, res, next) => {
    try {
      res.json({
        company: store.archive(
          await actor(req, true),
          String(req.params.id),
          true,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
