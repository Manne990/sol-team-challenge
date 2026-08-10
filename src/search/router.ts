import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
type Row = Record<string, unknown>;
class SearchError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const resources = new Set(["companies", "contacts", "deals", "tasks"]),
  allowedKeys = new Set([
    "q",
    "page",
    "pageSize",
    "sort",
    "direction",
    "archived",
    "lifecycle",
    "owner",
    "industry",
    "size",
    "tag",
    "company",
    "status",
    "stage",
    "assignee",
    "view",
    "contact",
    "deal",
  ]);
function send(error: unknown, response: Response) {
  if (error instanceof SearchError)
    response
      .status(error.statusCode)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(error.code === "forbidden" ? 403 : 401)
      .json({ error: { code: error.code, message: error.message } });
  else throw error;
}
function definition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SearchError(
      400,
      "INVALID_VIEW",
      "Saved view filters must be an object.",
    );
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowedKeys.has(key) || typeof item !== "string" || item.length > 200)
      throw new SearchError(
        400,
        "INVALID_VIEW",
        "This saved view contains unsupported filters.",
      );
    result[key] = item;
  }
  return result;
}
export function createSearchRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router(),
    auth = new AuthService(new SqliteAuthRepository(database)),
    principal = (request: Request) =>
      auth.authenticate(readSessionCookie(request.header("cookie"))),
    mutate = async (request: Request) => {
      const user = await principal(request);
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
  router.get("/", async (request, response) => {
    try {
      const user = await principal(request),
        query = String(request.query.q ?? "")
          .trim()
          .slice(0, 100);
      if (!query) {
        response.json({
          query,
          groups: { companies: [], contacts: [], deals: [], tasks: [] },
          total: 0,
        });
        return;
      }
      const pattern = `%${query.replace(/[\\%_]/gu, "\\$&")}%`,
        prefix = `${query.replace(/[\\%_]/gu, "\\$&")}%`;
      const companies = database
        .prepare(
          "SELECT id,name,industry context FROM companies WHERE organization_id=? AND archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR organization_number LIKE ? ESCAPE '\\' OR external_reference LIKE ? ESCAPE '\\') ORDER BY CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,name,id LIMIT 8",
        )
        .all(user.organizationId, pattern, pattern, pattern, prefix) as Row[];
      const contacts = database
        .prepare(
          "SELECT c.id,(c.first_name||' '||c.last_name) name,co.name context FROM contacts c LEFT JOIN companies co ON co.id=c.company_id AND co.organization_id=c.organization_id WHERE c.organization_id=? AND c.archived_at IS NULL AND (c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\') ORDER BY CASE WHEN c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,c.last_name,c.first_name,c.id LIMIT 8",
        )
        .all(
          user.organizationId,
          pattern,
          pattern,
          pattern,
          prefix,
          prefix,
        ) as Row[];
      const deals = database
        .prepare(
          "SELECT d.id,d.name,c.name context FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id WHERE d.organization_id=? AND d.archived_at IS NULL AND (d.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY CASE WHEN d.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,d.name,d.id LIMIT 8",
        )
        .all(user.organizationId, pattern, pattern, prefix) as Row[];
      const tasks = database
        .prepare(
          "SELECT id,title name,due_at context FROM tasks WHERE organization_id=? AND archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,title,id LIMIT 8",
        )
        .all(user.organizationId, pattern, pattern, prefix) as Row[];
      const map = (rows: Row[]) =>
        rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          context: row.context ? String(row.context) : null,
        }));
      response.json({
        query,
        groups: {
          companies: map(companies),
          contacts: map(contacts),
          deals: map(deals),
          tasks: map(tasks),
        },
        total: companies.length + contacts.length + deals.length + tasks.length,
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.get("/views", async (request, response) => {
    try {
      const user = await principal(request),
        rows = database
          .prepare(
            "SELECT id,resource,name,definition_json,created_at,updated_at,version FROM saved_views WHERE organization_id=? AND user_id=? ORDER BY resource,name,id",
          )
          .all(user.organizationId, user.userId) as Row[];
      response.json({
        items: rows.map((row) => ({
          id: String(row.id),
          resource: String(row.resource),
          name: String(row.name),
          definition: JSON.parse(String(row.definition_json)),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          version: Number(row.version),
        })),
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.post("/views", async (request, response) => {
    try {
      const user = await mutate(request),
        resource = String(request.body?.resource ?? ""),
        name = String(request.body?.name ?? "")
          .trim()
          .slice(0, 80);
      if (!resources.has(resource) || !name)
        throw new SearchError(
          400,
          "INVALID_VIEW",
          "Choose a list and enter a view name.",
        );
      const filters = definition(request.body?.definition),
        id = randomUUID(),
        now = new Date().toISOString();
      database
        .prepare(
          "INSERT INTO saved_views(id,organization_id,user_id,resource,name,definition_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          user.organizationId,
          user.userId,
          resource,
          name,
          JSON.stringify(filters),
          now,
          now,
        );
      response
        .status(201)
        .json({ id, resource, name, definition: filters, version: 1 });
    } catch (error) {
      if (error instanceof Error && /UNIQUE/.test(error.message))
        send(
          new SearchError(
            409,
            "VIEW_EXISTS",
            "You already have a saved view with that name.",
          ),
          response,
        );
      else send(error, response);
    }
  });
  router.put("/views/:id", async (request, response) => {
    try {
      const user = await mutate(request),
        resource = String(request.body?.resource ?? ""),
        name = String(request.body?.name ?? "")
          .trim()
          .slice(0, 80),
        filters = definition(request.body?.definition),
        version = Number(request.body?.version);
      if (!resources.has(resource) || !name || !Number.isInteger(version))
        throw new SearchError(
          400,
          "INVALID_VIEW",
          "Provide a valid list, name, filters, and version.",
        );
      const result = database
        .prepare(
          "UPDATE saved_views SET resource=?,name=?,definition_json=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND user_id=? AND version=?",
        )
        .run(
          resource,
          name,
          JSON.stringify(filters),
          new Date().toISOString(),
          request.params.id,
          user.organizationId,
          user.userId,
          version,
        );
      if (result.changes !== 1)
        throw new SearchError(
          409,
          "VIEW_CONFLICT",
          "This saved view changed or is no longer available.",
        );
      response.json({
        id: request.params.id,
        resource,
        name,
        definition: filters,
        version: version + 1,
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.delete("/views/:id", async (request, response) => {
    try {
      const user = await mutate(request);
      database
        .prepare(
          "DELETE FROM saved_views WHERE id=? AND organization_id=? AND user_id=?",
        )
        .run(request.params.id, user.organizationId, user.userId);
      response.status(204).end();
    } catch (error) {
      send(error, response);
    }
  });
  return router;
}
