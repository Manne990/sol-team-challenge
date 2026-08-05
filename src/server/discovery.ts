import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const RESOURCES = new Set(["companies", "contacts", "deals", "tasks"]);
const invalid = (message: string) =>
  new AuthError(400, "VALIDATION_ERROR", message);
const text = (value: unknown, name: string, maximum: number) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw invalid(`Enter a valid ${name}.`);
  return value.trim();
};
const definition = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("Saved view filters must be an object.");
  const serialized = JSON.stringify(value);
  if (serialized.length > 8_000)
    throw invalid("Saved view filters are too large.");
  return serialized;
};

export function discoveryRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const actor = async (request: Request) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      ["owner", "member", "viewer"],
    );

  router.get("/search", async (request, response, next) => {
    try {
      const user = await actor(request);
      const query = text(request.query.q, "search", 100);
      if (query.length < 2)
        throw invalid("Enter at least two characters to search.");
      const pattern = `%${query.replace(/[\\%_]/gu, "\\$&")}%`;
      const organizationId = user.organization.id;
      const run = (sql: string) =>
        db.prepare(sql).all(organizationId, pattern, pattern) as Row[];
      const companies = run(`SELECT id,name,industry context FROM companies
        WHERE organization_id=? AND archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR organization_number LIKE ? ESCAPE '\\')
        ORDER BY name COLLATE NOCASE,id LIMIT 5`);
      const contacts =
        run(`SELECT id,first_name||' '||last_name name,coalesce(email,'No email') context FROM contacts
        WHERE organization_id=? AND archived_at IS NULL AND (first_name||' '||last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
        ORDER BY last_name COLLATE NOCASE,first_name COLLATE NOCASE,id LIMIT 5`);
      const deals =
        run(`SELECT d.id,d.name,c.name context FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id
        WHERE d.organization_id=? AND d.archived_at IS NULL AND (d.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')
        ORDER BY d.name COLLATE NOCASE,d.id LIMIT 5`);
      const tasks =
        run(`SELECT id,title name,coalesce(due_at,'No due date') context FROM tasks
        WHERE organization_id=? AND archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
        ORDER BY title COLLATE NOCASE,id LIMIT 5`);
      response.json({ query, groups: { companies, contacts, deals, tasks } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/views", async (request, response, next) => {
    try {
      const user = await actor(request);
      const resource = text(request.query.resource, "resource", 30);
      if (!RESOURCES.has(resource))
        throw invalid("Choose a valid saved-view resource.");
      const rows = db
        .prepare(
          `SELECT id,name,definition_json,created_at,updated_at,version FROM saved_views
        WHERE organization_id=? AND owner_membership_id=? AND resource=? ORDER BY name COLLATE NOCASE,id`,
        )
        .all(user.organization.id, user.membershipId, resource) as Row[];
      response.json({
        views: rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          definition: JSON.parse(String(row.definition_json)),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          version: Number(row.version),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/views", async (request, response, next) => {
    try {
      const user = await actor(request);
      const body = (
        request.body && typeof request.body === "object" ? request.body : {}
      ) as Row;
      const resource = text(body.resource, "resource", 30);
      if (!RESOURCES.has(resource))
        throw invalid("Choose a valid saved-view resource.");
      const name = text(body.name, "view name", 80);
      const filters = definition(body.definition);
      const id = randomUUID(),
        now = new Date().toISOString();
      try {
        db.prepare(
          `INSERT INTO saved_views(id,organization_id,owner_membership_id,resource,name,definition_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          user.organization.id,
          user.membershipId,
          resource,
          name,
          filters,
          now,
          now,
        );
      } catch (error) {
        if (String(error).includes("UNIQUE"))
          throw new AuthError(
            409,
            "VIEW_CONFLICT",
            "A saved view already uses that name.",
          );
        throw error;
      }
      response.status(201).json({
        view: {
          id,
          name,
          resource,
          definition: JSON.parse(filters),
          createdAt: now,
          updatedAt: now,
          version: 1,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/views/:id", async (request, response, next) => {
    try {
      const user = await actor(request);
      const body = (
        request.body && typeof request.body === "object" ? request.body : {}
      ) as Row;
      const name = text(body.name, "view name", 80),
        filters = definition(body.definition),
        version = Number(body.version);
      if (!Number.isInteger(version))
        throw invalid("Refresh the saved view before updating it.");
      const now = new Date().toISOString();
      let result: Row;
      try {
        result = db
          .prepare(
            `UPDATE saved_views SET name=?,definition_json=?,updated_at=?,version=version+1
          WHERE id=? AND organization_id=? AND owner_membership_id=? AND version=?`,
          )
          .run(
            name,
            filters,
            now,
            String(request.params.id),
            user.organization.id,
            user.membershipId,
            version,
          ) as Row;
      } catch (error) {
        if (String(error).includes("UNIQUE"))
          throw new AuthError(
            409,
            "VIEW_CONFLICT",
            "A saved view already uses that name.",
          );
        throw error;
      }
      if (Number(result.changes) === 0) {
        const exists = db
          .prepare(
            "SELECT 1 FROM saved_views WHERE id=? AND organization_id=? AND owner_membership_id=?",
          )
          .get(
            String(request.params.id),
            user.organization.id,
            user.membershipId,
          );
        throw exists
          ? new AuthError(
              409,
              "EDIT_CONFLICT",
              "This saved view changed. Refresh and try again.",
            )
          : new AuthError(404, "NOT_FOUND", "Saved view not found.");
      }
      response.json({
        view: {
          id: String(request.params.id),
          name,
          definition: JSON.parse(filters),
          updatedAt: now,
          version: version + 1,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/views/:id", async (request, response, next) => {
    try {
      const user = await actor(request);
      const result = db
        .prepare(
          "DELETE FROM saved_views WHERE id=? AND organization_id=? AND owner_membership_id=?",
        )
        .run(
          String(request.params.id),
          user.organization.id,
          user.membershipId,
        ) as Row;
      if (Number(result.changes) === 0)
        throw new AuthError(404, "NOT_FOUND", "Saved view not found.");
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
