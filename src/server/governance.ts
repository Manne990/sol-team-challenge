import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const safeSummary = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.slice(0, 20).map(safeSummary);
  if (!value || typeof value !== "object")
    return typeof value === "string" ? value.slice(0, 300) : value;
  return Object.fromEntries(
    Object.entries(value as Row)
      .filter(
        ([key]) =>
          !/(password|credential|secret|token|session|raw|content|complete.?row)/iu.test(
            key,
          ),
      )
      .slice(0, 30)
      .map(([key, item]) => [key, safeSummary(item)]),
  );
};
const parseSummary = (value: unknown) => {
  try {
    return safeSummary(JSON.parse(String(value)));
  } catch {
    return {};
  }
};
const text = (value: unknown, maximum: number, label: string) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw new AuthError(400, "VALIDATION_ERROR", `Enter a valid ${label}.`);
  return value.trim();
};

export class GovernanceStore {
  constructor(private db: SqliteDatabase) {}
  organization(org: string) {
    const row = this.db
      .prepare(
        "SELECT id,name,settings_json,created_at,updated_at,version FROM organizations WHERE id=?",
      )
      .get(org) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      settings: parseSummary(row.settings_json),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      version: Number(row.version),
    };
  }
  updateOrganization(actor: AuthenticatedUser, body: unknown) {
    const input = body && typeof body === "object" ? (body as Row) : {},
      name = text(input.name, 120, "organization name"),
      version = Number(input.version);
    if (!Number.isInteger(version))
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Refresh organization settings before saving.",
      );
    const settings =
      input.settings && typeof input.settings === "object"
        ? (input.settings as Row)
        : {};
    const timezone = text(settings.timezone ?? "UTC", 80, "timezone"),
      locale = text(settings.locale ?? "en", 20, "locale"),
      currency = text(settings.currency ?? "USD", 3, "currency").toUpperCase();
    try {
      Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Choose a valid IANA timezone.",
      );
    }
    if (!/^[A-Z]{3}$/u.test(currency))
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Choose a three-letter currency.",
      );
    const now = new Date().toISOString(),
      result = this.db
        .prepare(
          "UPDATE organizations SET name=?,settings_json=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
        )
        .run(
          name,
          JSON.stringify({ timezone, locale, currency }),
          now,
          actor.organization.id,
          version,
        );
    if (Number((result as Row).changes) === 0)
      throw new AuthError(
        409,
        "EDIT_CONFLICT",
        "Organization settings changed. Refresh and review them.",
      );
    this.audit(
      actor,
      "organization.updated",
      actor.organization.id,
      { name, timezone, locale, currency },
      now,
    );
    return this.organization(actor.organization.id)!;
  }
  auditList(org: string, query: Row) {
    const conditions = ["a.organization_id=?"],
      args: unknown[] = [org];
    for (const [key, column] of [
      ["action", "a.action"],
      ["entityType", "a.entity_type"],
      ["actorId", "a.actor_membership_id"],
      ["entityId", "a.entity_id"],
    ] as const)
      if (typeof query[key] === "string" && query[key]) {
        conditions.push(`${column}=?`);
        args.push(query[key]);
      }
    if (typeof query.from === "string" && query.from) {
      conditions.push("a.created_at>=?");
      args.push(query.from);
    }
    if (typeof query.to === "string" && query.to) {
      conditions.push("a.created_at<=?");
      args.push(query.to);
    }
    const page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25)),
      where = conditions.join(" AND "),
      total = Number(
        (
          this.db
            .prepare(`SELECT count(*) count FROM audit_events a WHERE ${where}`)
            .get(...args) as Row
        ).count,
      );
    const rows = this.db
      .prepare(
        `SELECT a.*,trim(coalesce(u.first_name,'')||' '||coalesce(u.last_name,'')) actor_name FROM audit_events a LEFT JOIN memberships m ON m.id=a.actor_membership_id AND m.organization_id=a.organization_id LEFT JOIN users u ON u.id=m.user_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as Row[];
    return {
      events: rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        actor: row.actor_membership_id
          ? {
              id: String(row.actor_membership_id),
              name: String(row.actor_name || "Former member"),
            }
          : null,
        action: String(row.action),
        entityType: String(row.entity_type),
        entityId: row.entity_id === null ? null : String(row.entity_id),
        correlationId: String(row.correlation_id),
        summary: parseSummary(row.summary_json),
        createdAt: String(row.created_at),
      })),
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
  private audit(
    actor: AuthenticatedUser,
    action: string,
    id: string,
    summary: object,
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
        "organization",
        id,
        randomUUID(),
        JSON.stringify(summary),
        now,
      );
  }
}

const owner = async (request: Request, auth: AuthService) =>
  auth.requireRole(
    await auth.authenticate(readCookie(request.headers.cookie, SESSION_COOKIE)),
    ["owner"],
  );
export function governanceRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router(),
    store = new GovernanceStore(db);
  router.get("/organization", async (req, res, next) => {
    try {
      const actor = await owner(req, auth),
        organization = store.organization(actor.organization.id);
      res.json({ organization });
    } catch (e) {
      next(e);
    }
  });
  router.patch("/organization", async (req, res, next) => {
    try {
      res.json({
        organization: store.updateOrganization(
          await owner(req, auth),
          req.body,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get("/audit", async (req, res, next) => {
    try {
      const actor = await owner(req, auth);
      res.json(store.auditList(actor.organization.id, req.query as Row));
    } catch (e) {
      next(e);
    }
  });
  return router;
}
