import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { hashPassword, AuthError, AuthService } from "../auth/service.js";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
import type { Principal, Role } from "../auth/types.js";
type Row = Record<string, unknown>;
class AdminError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const roles = new Set(["owner", "member", "viewer"]);
const safe = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function send(error: unknown, response: Response) {
  if (error instanceof AdminError)
    response
      .status(error.statusCode)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(
        error.code === "forbidden"
          ? 403
          : error.code === "conflict"
            ? 409
            : 401,
      )
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof Error && /UNIQUE/.test(error.message))
    response.status(409).json({
      error: {
        code: "MEMBER_EXISTS",
        message: "That email already belongs to an account.",
      },
    });
  else throw error;
}
export function createAdminRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router(),
    auth = new AuthService(new SqliteAuthRepository(database)),
    principal = (request: Request) =>
      auth.authenticate(readSessionCookie(request.header("cookie"))),
    owner = async (request: Request) => {
      const actor = await principal(request);
      auth.requireOwner(actor);
      if (
        !requestHasTrustedOrigin(
          request.header("origin"),
          request.header("host"),
          secureCookies,
        ) &&
        request.method !== "GET"
      )
        throw new AuthError("forbidden", "The request origin is not allowed.");
      return actor;
    };
  const audit = (
    actor: Principal,
    action: string,
    type: string,
    id: string | null,
    summary: object,
    requestId: string,
  ) =>
    database
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        actor.organizationId,
        actor.userId,
        action,
        type,
        id,
        requestId,
        JSON.stringify(summary),
        new Date().toISOString(),
      );
  router.get("/organization", async (request, response) => {
    try {
      const actor = await owner(request),
        organization = database
          .prepare(
            "SELECT id,name,slug,settings_json,version,created_at,updated_at FROM organizations WHERE id=?",
          )
          .get(actor.organizationId) as Row,
        members = database
          .prepare(
            "SELECT m.user_id id,u.email,u.display_name name,m.role,m.created_at,m.revoked_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY m.revoked_at IS NOT NULL,u.display_name",
          )
          .all(actor.organizationId) as Row[];
      response.json({
        organization: {
          id: String(organization.id),
          name: String(organization.name),
          slug: String(organization.slug),
          settings: JSON.parse(String(organization.settings_json)),
          version: Number(organization.version),
          createdAt: String(organization.created_at),
          updatedAt: String(organization.updated_at),
        },
        members: members.map((row) => ({
          id: String(row.id),
          email: String(row.email),
          name: String(row.name),
          role: String(row.role),
          createdAt: String(row.created_at),
          revokedAt: row.revoked_at ? String(row.revoked_at) : null,
          self: row.id === actor.userId,
        })),
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.put("/organization", async (request, response) => {
    try {
      const actor = await owner(request),
        name = safe(request.body?.name, 160),
        timezone = safe(request.body?.timezone, 80) || "UTC",
        version = Number(request.body?.version);
      if (!name || !Number.isInteger(version))
        throw new AdminError(
          400,
          "VALIDATION",
          "Organization name and current version are required.",
        );
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
      } catch {
        throw new AdminError(
          400,
          "VALIDATION",
          "Choose a valid IANA timezone.",
        );
      }
      const now = new Date().toISOString(),
        result = database
          .prepare(
            "UPDATE organizations SET name=?,settings_json=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
          )
          .run(
            name,
            JSON.stringify({ timezone }),
            now,
            actor.organizationId,
            version,
          );
      if (result.changes !== 1)
        throw new AdminError(
          409,
          "EDIT_CONFLICT",
          "Organization settings changed. Refresh before saving.",
        );
      audit(
        actor,
        "organization.updated",
        "organization",
        actor.organizationId,
        { fields: ["name", "timezone"] },
        String(response.locals.requestId),
      );
      response.json({
        name,
        settings: { timezone },
        version: version + 1,
        updatedAt: now,
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.post("/members", async (request, response) => {
    try {
      const actor = await owner(request),
        email = safe(request.body?.email, 254).toLowerCase(),
        name = safe(request.body?.name, 120),
        password = String(request.body?.password ?? ""),
        role = String(request.body?.role ?? "") as Role;
      if (!/^\S+@\S+\.\S+$/u.test(email) || !name || !roles.has(role))
        throw new AdminError(
          400,
          "VALIDATION",
          "Enter a valid name, email, and role.",
        );
      const id = randomUUID(),
        now = new Date().toISOString(),
        passwordHash = await hashPassword(password);
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          )
          .run(id, email, passwordHash, name, now, now);
        database
          .prepare(
            "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES(?,?,?,?)",
          )
          .run(actor.organizationId, id, role, now);
        audit(
          actor,
          "membership.created",
          "membership",
          id,
          { email, role },
          String(response.locals.requestId),
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(201).json({
        id,
        email,
        name,
        role,
        createdAt: now,
        revokedAt: null,
        self: false,
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.put("/members/:id", async (request, response) => {
    try {
      const actor = await owner(request),
        role = String(request.body?.role ?? "") as Role;
      if (!roles.has(role))
        throw new AdminError(400, "VALIDATION", "Choose a valid role.");
      const membership = `${actor.organizationId}:${request.params.id}`;
      await auth.changeRole(actor, membership, role);
      audit(
        actor,
        "membership.role_changed",
        "membership",
        request.params.id,
        { role },
        String(response.locals.requestId),
      );
      response.json({ id: request.params.id, role });
    } catch (error) {
      send(error, response);
    }
  });
  router.delete("/members/:id", async (request, response) => {
    try {
      const actor = await owner(request);
      if (request.params.id === actor.userId)
        throw new AdminError(
          409,
          "SELF_REVOCATION",
          "Sign in as another owner to revoke your own access.",
        );
      await auth.revokeMembership(
        actor,
        `${actor.organizationId}:${request.params.id}`,
      );
      audit(
        actor,
        "membership.revoked",
        "membership",
        request.params.id,
        {},
        String(response.locals.requestId),
      );
      response.status(204).end();
    } catch (error) {
      send(error, response);
    }
  });
  router.get("/audit", async (request, response) => {
    try {
      const actor = await owner(request),
        page = Math.max(1, Number(request.query.page) || 1),
        pageSize = Math.min(
          100,
          Math.max(1, Number(request.query.pageSize) || 25),
        ),
        where = ["a.organization_id=?"],
        values: SQLInputValue[] = [actor.organizationId];
      for (const [query, column] of [
        ["action", "a.action"],
        ["actor", "a.actor_id"],
        ["entityType", "a.entity_type"],
        ["entityId", "a.entity_id"],
      ] as const)
        if (typeof request.query[query] === "string" && request.query[query]) {
          where.push(`${column}=?`);
          values.push(String(request.query[query]));
        }
      if (typeof request.query.from === "string" && request.query.from) {
        where.push("a.occurred_at>=?");
        values.push(request.query.from);
      }
      if (typeof request.query.to === "string" && request.query.to) {
        where.push("a.occurred_at<=?");
        values.push(request.query.to);
      }
      const clause = where.join(" AND "),
        total = Number(
          (
            database
              .prepare(
                `SELECT count(*) total FROM audit_events a WHERE ${clause}`,
              )
              .get(...values) as Row
          ).total,
        ),
        rows = database
          .prepare(
            `SELECT a.*,u.display_name actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE ${clause} ORDER BY a.occurred_at DESC,a.id DESC LIMIT ? OFFSET ?`,
          )
          .all(...values, pageSize, (page - 1) * pageSize) as Row[];
      response.json({
        items: rows.map((row) => ({
          id: String(row.id),
          actorId: row.actor_id ? String(row.actor_id) : null,
          actorName: row.actor_name ? String(row.actor_name) : "System",
          action: String(row.action),
          entityType: String(row.entity_type),
          entityId: row.entity_id ? String(row.entity_id) : null,
          correlationId: String(row.correlation_id),
          summary: JSON.parse(String(row.summary_json)),
          occurredAt: String(row.occurred_at),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      send(error, response);
    }
  });
  return router;
}
