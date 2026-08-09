import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const sensitive = /password|secret|token|session|credential|csv|row|payload/iu;
export function safeAuditSummary(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => safeAuditSummary(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Row).map(([key, item]) => [
        key,
        sensitive.test(key) ? "[redacted]" : safeAuditSummary(item, depth + 1),
      ]),
    );
  if (typeof value === "string" && value.length > 500)
    return `${value.slice(0, 500)}…`;
  return value;
}
const validation = (message: string) =>
  new AuthError(400, "VALIDATION_ERROR", message);
export function governanceRouter(database: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const owner = async (request: Request) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      ["owner"],
    );
  router.get("/organization", async (request, response, next) => {
    try {
      const user = await owner(request);
      const row = database
        .prepare(
          "SELECT id,name,settings_json,updated_at,version FROM organizations WHERE id=?",
        )
        .get(user.organization.id) as Row;
      response.json({
        organization: {
          id: String(row.id),
          name: String(row.name),
          settings: JSON.parse(String(row.settings_json)),
          updatedAt: String(row.updated_at),
          version: Number(row.version),
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch("/organization", async (request, response, next) => {
    try {
      const user = await owner(request),
        body = request.body as Row | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "",
        currency =
          typeof body?.currency === "string"
            ? body.currency.trim().toUpperCase()
            : "",
        timezone =
          typeof body?.timezone === "string" ? body.timezone.trim() : "",
        staleAccountDays = Number(body?.staleAccountDays),
        version = Number(body?.version);
      if (!name || name.length > 160)
        throw validation(
          "Enter an organization name of 160 characters or fewer.",
        );
      if (!/^[A-Z]{3}$/u.test(currency))
        throw validation("Enter a three-letter reporting currency.");
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      } catch {
        throw validation("Choose a valid IANA timezone.");
      }
      if (
        !Number.isInteger(staleAccountDays) ||
        staleAccountDays < 1 ||
        staleAccountDays > 365
      )
        throw validation("Stale account days must be from 1 to 365.");
      if (!Number.isInteger(version) || version < 1)
        throw validation("Refresh organization settings before saving.");
      const now = new Date().toISOString(),
        settings = { currency, timezone, staleAccountDays };
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database
          .prepare(
            "UPDATE organizations SET name=?,settings_json=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
          )
          .run(
            name,
            JSON.stringify(settings),
            now,
            user.organization.id,
            version,
          ) as Row;
        if (Number(result.changes ?? 0) === 0)
          throw new AuthError(
            409,
            "EDIT_CONFLICT",
            "Organization settings changed. Refresh and compare before saving.",
          );
        database
          .prepare(
            "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            user.organization.id,
            user.membershipId,
            "organization.updated",
            "organization",
            user.organization.id,
            randomUUID(),
            JSON.stringify({ name, currency, timezone, staleAccountDays }),
            now,
          );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      const updated = database
        .prepare(
          "SELECT id,name,settings_json,updated_at,version FROM organizations WHERE id=?",
        )
        .get(user.organization.id) as Row;
      response.json({
        organization: {
          id: String(updated.id),
          name: String(updated.name),
          settings: JSON.parse(String(updated.settings_json)),
          updatedAt: String(updated.updated_at),
          version: Number(updated.version),
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/audit", async (request, response, next) => {
    try {
      const user = await owner(request),
        page = Math.max(1, Number(request.query.page) || 1),
        pageSize = Math.min(
          100,
          Math.max(1, Number(request.query.pageSize) || 25),
        ),
        clauses = ["a.organization_id=?"],
        args: unknown[] = [user.organization.id];
      for (const [query, column] of [
        ["action", "a.action"],
        ["entityType", "a.entity_type"],
        ["actor", "a.actor_membership_id"],
      ] as const)
        if (typeof request.query[query] === "string" && request.query[query]) {
          clauses.push(`${column}=?`);
          args.push(request.query[query]);
        }
      if (
        typeof request.query.from === "string" &&
        /^\d{4}-\d{2}-\d{2}/u.test(request.query.from)
      ) {
        clauses.push("a.created_at>=?");
        args.push(request.query.from);
      }
      if (
        typeof request.query.to === "string" &&
        /^\d{4}-\d{2}-\d{2}/u.test(request.query.to)
      ) {
        clauses.push("a.created_at<=?");
        args.push(request.query.to);
      }
      const where = clauses.join(" AND "),
        total = Number(
          (
            database
              .prepare(
                `SELECT count(*) count FROM audit_events a WHERE ${where}`,
              )
              .get(...args) as Row
          ).count,
        );
      const rows = database
        .prepare(
          `SELECT a.*,trim(coalesce(u.first_name,'')||' '||coalesce(u.last_name,'')) actor_name,u.email actor_email FROM audit_events a LEFT JOIN memberships m ON m.id=a.actor_membership_id AND m.organization_id=a.organization_id LEFT JOIN users u ON u.id=m.user_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, (page - 1) * pageSize) as Row[];
      response.json({
        items: rows.map((row) => ({
          id: String(row.id),
          actor: row.actor_membership_id
            ? {
                id: String(row.actor_membership_id),
                name: String(row.actor_name),
                email: String(row.actor_email),
              }
            : null,
          action: String(row.action),
          entityType: String(row.entity_type),
          entityId: row.entity_id === null ? null : String(row.entity_id),
          correlationId: String(row.correlation_id),
          summary: safeAuditSummary(JSON.parse(String(row.summary_json))),
          createdAt: String(row.created_at),
        })),
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
