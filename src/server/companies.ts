import { randomUUID } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { AuthenticatedUser, Role } from "../shared/auth.js";
import {
  companyLifecycles,
  type Company,
  type CompanyInput,
} from "../shared/companies.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
type AuthedRequest = Request & { authUser?: AuthenticatedUser };

export class CompanyError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const cleanOptional = (value: unknown, max = 300) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw new CompanyError(
      400,
      "VALIDATION_ERROR",
      "Review the highlighted company fields.",
    );
  return value.trim();
};

export function validateCompany(value: unknown): CompanyInput {
  if (!value || typeof value !== "object")
    throw new CompanyError(
      400,
      "VALIDATION_ERROR",
      "Company details are required.",
    );
  const body = value as Record<string, unknown>;
  const name = cleanOptional(body.name, 160);
  if (!name)
    throw new CompanyError(
      400,
      "VALIDATION_ERROR",
      "Company name is required.",
    );
  if (!companyLifecycles.includes(body.lifecycleStatus as never))
    throw new CompanyError(
      400,
      "VALIDATION_ERROR",
      "Choose a valid lifecycle.",
    );
  const tags = body.tags ?? [];
  if (
    !Array.isArray(tags) ||
    tags.length > 20 ||
    tags.some(
      (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 40,
    )
  )
    throw new CompanyError(
      400,
      "VALIDATION_ERROR",
      "Tags must be short, non-empty labels.",
    );
  const address = body.address ?? {};
  if (
    !address ||
    typeof address !== "object" ||
    Array.isArray(address) ||
    Object.values(address).some(
      (part) => typeof part !== "string" || part.length > 160,
    )
  )
    throw new CompanyError(400, "VALIDATION_ERROR", "Enter a valid address.");
  const website = cleanOptional(body.website, 300);
  if (website && !/^https?:\/\/[^\s]+$/iu.test(website))
    throw new CompanyError(
      400,
      "VALIDATION_ERROR",
      "Website must begin with http:// or https://.",
    );
  return {
    name,
    organizationNumber: cleanOptional(body.organizationNumber, 100),
    externalReference: cleanOptional(body.externalReference, 100),
    website,
    phone: cleanOptional(body.phone, 80),
    industry: cleanOptional(body.industry, 100),
    size: cleanOptional(body.size, 80),
    address: Object.fromEntries(
      Object.entries(address as Record<string, string>).map(([key, part]) => [
        key,
        part.trim(),
      ]),
    ),
    lifecycleStatus: body.lifecycleStatus as CompanyInput["lifecycleStatus"],
    ownerMembershipId: cleanOptional(body.ownerMembershipId, 100),
    tags: [...new Set((tags as string[]).map((tag) => tag.trim()))],
    description: cleanOptional(body.description, 5000) ?? "",
    version:
      typeof body.version === "number" && Number.isInteger(body.version)
        ? body.version
        : undefined,
  };
}

export class CompanyService {
  constructor(private db: SqliteDatabase) {}
  private require(user: AuthenticatedUser | undefined, roles: Role[]) {
    if (!user)
      throw new AuthError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
      );
    if (!roles.includes(user.role))
      throw new AuthError(
        403,
        "FORBIDDEN",
        "You do not have permission to do that.",
      );
    return user;
  }
  private map(row: Row): Company {
    return {
      id: String(row.id),
      name: String(row.name),
      organizationNumber:
        row.organization_number == null
          ? null
          : String(row.organization_number),
      externalReference:
        row.external_reference == null ? null : String(row.external_reference),
      website: row.website == null ? null : String(row.website),
      phone: row.phone == null ? null : String(row.phone),
      industry: row.industry == null ? null : String(row.industry),
      size: row.size == null ? null : String(row.size),
      address: JSON.parse(String(row.address_json)) as Record<string, string>,
      lifecycleStatus: row.lifecycle_status as Company["lifecycleStatus"],
      owner: row.owner_id
        ? {
            id: String(row.owner_id),
            name: `${String(row.owner_first)} ${String(row.owner_last)}`,
          }
        : null,
      tags: JSON.parse(String(row.tags_json)) as string[],
      description: String(row.description),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      archivedAt: row.archived_at == null ? null : String(row.archived_at),
      version: Number(row.version),
    };
  }
  list(user: AuthenticatedUser | undefined, query: Record<string, unknown>) {
    const actor = this.require(user, ["owner", "member", "viewer"]);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const conditions = ["c.organization_id=?"];
    const params: unknown[] = [actor.organization.id];
    if (query.includeArchived !== "true")
      conditions.push("c.archived_at IS NULL");
    const exact: Array<[string, string]> = [
      ["lifecycle", "c.lifecycle_status"],
      ["owner", "c.owner_membership_id"],
      ["industry", "c.industry"],
      ["size", "c.size"],
    ];
    for (const [key, column] of exact)
      if (typeof query[key] === "string" && query[key]) {
        conditions.push(`${column}=?`);
        params.push(query[key]);
      }
    if (typeof query.tag === "string" && query.tag) {
      conditions.push(
        "EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE value=?)",
      );
      params.push(query.tag);
    }
    if (typeof query.q === "string" && query.q.trim()) {
      conditions.push(
        "(c.name LIKE ? ESCAPE '\\' OR c.organization_number LIKE ? ESCAPE '\\' OR c.external_reference LIKE ? ESCAPE '\\')",
      );
      const term = `%${query.q.trim().replace(/[\\%_]/gu, "\\$&")}%`;
      params.push(term, term, term);
    }
    if (
      typeof query.lastActivityBefore === "string" &&
      query.lastActivityBefore
    ) {
      conditions.push(`NOT EXISTS(SELECT 1 FROM activities a WHERE a.organization_id=c.organization_id
        AND a.company_id=c.id AND a.occurred_at>=?)`);
      params.push(query.lastActivityBefore);
    }
    const allowedSort: Record<string, string> = {
      name: "c.name",
      updatedAt: "c.updated_at",
      createdAt: "c.created_at",
      industry: "c.industry",
      lifecycle: "c.lifecycle_status",
    };
    const sort = allowedSort[String(query.sort)] ?? "c.name";
    const direction = query.direction === "desc" ? "DESC" : "ASC";
    const where = conditions.join(" AND ");
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) total FROM companies c WHERE ${where}`)
          .get(...params) as Row
      ).total,
    );
    const rows = this.db
      .prepare(
        `SELECT c.*,m.id owner_id,u.first_name owner_first,u.last_name owner_last FROM companies c LEFT JOIN memberships m ON m.id=c.owner_membership_id AND m.organization_id=c.organization_id LEFT JOIN users u ON u.id=m.user_id WHERE ${where} ORDER BY ${sort} ${direction},c.id ${direction} LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Row[];
    return {
      companies: rows.map((row) => this.map(row)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
  detail(user: AuthenticatedUser | undefined, id: string) {
    const actor = this.require(user, ["owner", "member", "viewer"]);
    const row = this.row(actor.organization.id, id);
    if (!row) throw new CompanyError(404, "NOT_FOUND", "Company not found.");
    const count = (table: string) =>
      Number(
        (
          this.db
            .prepare(
              `SELECT count(*) total FROM ${table} WHERE organization_id=? AND company_id=?`,
            )
            .get(actor.organization.id, id) as Row
        ).total,
      );
    const history = (
      this.db
        .prepare(
          "SELECT action,created_at,summary_json FROM audit_events WHERE organization_id=? AND entity_type='company' AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT 50",
        )
        .all(actor.organization.id, id) as Row[]
    ).map((event) => ({
      action: String(event.action),
      timestamp: String(event.created_at),
      summary: JSON.parse(String(event.summary_json)) as Record<
        string,
        unknown
      >,
    }));
    const activities = this.db
      .prepare(
        "SELECT id,type,subject,body,occurred_at occurredAt,creator_label creatorLabel,follow_up_task_id followUpTaskId FROM activities WHERE organization_id=? AND company_id=? ORDER BY occurred_at DESC,id DESC LIMIT 50",
      )
      .all(actor.organization.id, id) as Row[];
    return {
      ...this.map(row),
      relatedCounts: {
        contacts: count("contacts"),
        activities: count("activities"),
        deals: count("deals"),
        tasks: count("tasks"),
      },
      history,
      activities,
    };
  }
  resolve(user: AuthenticatedUser | undefined, id: string) {
    const actor = this.require(user, ["owner", "member", "viewer"]);
    const redirect = this.db
      .prepare(
        "SELECT survivor_id FROM merge_redirects WHERE organization_id=? AND entity_type='company' AND retired_id=?",
      )
      .get(actor.organization.id, id) as Row | undefined;
    return {
      id: redirect ? String(redirect.survivor_id) : id,
      redirectedFrom: redirect ? id : null,
    };
  }
  create(user: AuthenticatedUser | undefined, value: unknown) {
    const actor = this.require(user, ["owner", "member"]);
    const input = validateCompany(value);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.write("insert", actor, id, input, now);
    return this.detail(actor, id);
  }
  update(user: AuthenticatedUser | undefined, id: string, value: unknown) {
    const actor = this.require(user, ["owner", "member"]);
    const input = validateCompany(value);
    if (!input.version)
      throw new CompanyError(
        400,
        "VALIDATION_ERROR",
        "Refresh the company before saving.",
      );
    const current = this.row(actor.organization.id, id);
    if (!current)
      throw new CompanyError(404, "NOT_FOUND", "Company not found.");
    const now = new Date().toISOString();
    this.write("update", actor, id, input, now);
    return this.detail(actor, id);
  }
  archive(user: AuthenticatedUser | undefined, id: string, restore = false) {
    const actor = this.require(user, ["owner", "member"]);
    const current = this.row(actor.organization.id, id);
    if (!current)
      throw new CompanyError(404, "NOT_FOUND", "Company not found.");
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE companies SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
        )
        .run(restore ? null : now, now, id, actor.organization.id);
      this.audit(
        actor,
        id,
        restore ? "company.restored" : "company.archived",
        {},
        now,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.detail(actor, id);
  }
  private row(org: string, id: string) {
    return this.db
      .prepare(
        "SELECT c.*,m.id owner_id,u.first_name owner_first,u.last_name owner_last FROM companies c LEFT JOIN memberships m ON m.id=c.owner_membership_id AND m.organization_id=c.organization_id LEFT JOIN users u ON u.id=m.user_id WHERE c.organization_id=? AND c.id=?",
      )
      .get(org, id) as Row | undefined;
  }
  private write(
    mode: "insert" | "update",
    actor: AuthenticatedUser,
    id: string,
    input: CompanyInput,
    now: string,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        input.ownerMembershipId &&
        !this.db
          .prepare(
            "SELECT 1 FROM memberships WHERE id=? AND organization_id=? AND status='active'",
          )
          .get(input.ownerMembershipId, actor.organization.id)
      )
        throw new CompanyError(
          400,
          "VALIDATION_ERROR",
          "Choose an active owner in this organization.",
        );
      const values = [
        input.name,
        input.organizationNumber ?? null,
        input.externalReference ?? null,
        input.website ?? null,
        input.phone ?? null,
        input.industry ?? null,
        input.size ?? null,
        JSON.stringify(input.address ?? {}),
        input.lifecycleStatus,
        input.ownerMembershipId ?? null,
        JSON.stringify(input.tags ?? []),
        input.description ?? "",
      ];
      if (mode === "insert")
        this.db
          .prepare(
            "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address_json,lifecycle_status,owner_membership_id,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(id, actor.organization.id, ...values, now, now);
      else {
        const result = this.db
          .prepare(
            "UPDATE companies SET name=?,organization_number=?,external_reference=?,website=?,phone=?,industry=?,size=?,address_json=?,lifecycle_status=?,owner_membership_id=?,tags_json=?,description=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(...values, now, id, actor.organization.id, input.version);
        if (Number((result as { changes?: number }).changes ?? 0) === 0)
          throw new CompanyError(
            409,
            "EDIT_CONFLICT",
            "This company changed since you opened it. Refresh and compare before saving.",
          );
      }
      this.audit(
        actor,
        id,
        mode === "insert" ? "company.created" : "company.updated",
        { name: input.name, lifecycleStatus: input.lifecycleStatus },
        now,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (error instanceof CompanyError) throw error;
      if (
        error instanceof Error &&
        /UNIQUE constraint failed/iu.test(error.message)
      )
        throw new CompanyError(
          409,
          "DUPLICATE_COMPANY",
          "A company with that organization number or external reference already exists.",
        );
      throw error;
    }
  }
  private audit(
    actor: AuthenticatedUser,
    id: string,
    action: string,
    summary: Record<string, unknown>,
    now: string,
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
        now,
      );
  }
}

export function companyRouter(service: CompanyService, auth: AuthService) {
  const router = Router();
  router.use(async (req: AuthedRequest, _res, next) => {
    try {
      req.authUser = await auth.authenticate(
        readCookie(req.headers.cookie, SESSION_COOKIE),
      );
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get("/", (req: AuthedRequest, res, next) => {
    try {
      res.json(service.list(req.authUser, req.query));
    } catch (e) {
      next(e);
    }
  });
  router.post("/", (req: AuthedRequest, res, next) => {
    try {
      res.status(201).json({ company: service.create(req.authUser, req.body) });
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id", (req: AuthedRequest, res, next) => {
    try {
      const resolved = service.resolve(req.authUser, String(req.params.id));
      res.json({
        company: service.detail(req.authUser, resolved.id),
        redirectedFrom: resolved.redirectedFrom,
      });
    } catch (e) {
      next(e);
    }
  });
  router.put("/:id", (req: AuthedRequest, res, next) => {
    try {
      res.json({
        company: service.update(req.authUser, String(req.params.id), req.body),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post("/:id/archive", (req: AuthedRequest, res, next) => {
    try {
      res.json({
        company: service.archive(req.authUser, String(req.params.id)),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post("/:id/restore", (req: AuthedRequest, res, next) => {
    try {
      res.json({
        company: service.archive(req.authUser, String(req.params.id), true),
      });
    } catch (e) {
      next(e);
    }
  });
  return router;
}

export function companyErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!(error instanceof CompanyError)) return next(error);
  res
    .status(error.status)
    .json({ error: { code: error.code, message: error.message } });
}
