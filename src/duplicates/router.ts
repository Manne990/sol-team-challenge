import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";

type EntityType = "company" | "contact";
type Row = Record<string, unknown>;
class MergeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const definitions = {
  company: {
    table: "companies",
    fields: [
      "name",
      "organization_number",
      "external_reference",
      "website",
      "phone",
      "industry",
      "size",
      "address",
      "lifecycle_status",
      "owner_id",
      "tags_json",
      "description",
    ],
  },
  contact: {
    table: "contacts",
    fields: [
      "company_id",
      "first_name",
      "last_name",
      "email",
      "phone",
      "job_title",
      "owner_id",
      "status",
      "tags_json",
      "communication_preference",
    ],
  },
} as const;
const typeOf = (value: unknown): EntityType => {
  if (value === "company" || value === "contact") return value;
  throw new MergeError(
    400,
    "VALIDATION",
    "Choose company or contact duplicates.",
  );
};
const normalized = (
  value: unknown,
  kind: "text" | "phone" | "website" = "text",
) => {
  if (value === null || value === undefined) return null;
  let result = String(value).trim().toLowerCase().normalize("NFKC");
  result = result.replace(/\s+/gu, " ");
  if (kind === "phone") result = result.replace(/[^0-9+]/gu, "");
  if (kind === "website") {
    try {
      result = new URL(
        result.includes("://") ? result : `https://${result}`,
      ).hostname.replace(/^www\./u, "");
    } catch {
      /* retain normalized input */
    }
  }
  return result || null;
};
function facts(type: EntityType, row: Row) {
  return type === "company"
    ? {
        name: normalized(row.name),
        organizationNumber: normalized(row.organization_number),
        externalReference: normalized(row.external_reference),
        websiteHost: normalized(row.website, "website"),
        phone: normalized(row.phone, "phone"),
      }
    : {
        email: normalized(row.email),
        name: normalized(`${row.first_name ?? ""} ${row.last_name ?? ""}`),
        phone: normalized(row.phone, "phone"),
      };
}
function candidates(type: EntityType, rows: Row[]) {
  const output: object[] = [];
  for (let left = 0; left < rows.length; left++)
    for (let right = left + 1; right < rows.length; right++) {
      const first = rows[left]!,
        second = rows[right]!,
        a = facts(type, first),
        b = facts(type, second);
      const matches = Object.keys(a).filter(
        (key) =>
          a[key as keyof typeof a] &&
          a[key as keyof typeof a] === b[key as keyof typeof b],
      );
      if (matches.length)
        output.push({
          candidateId: `${type}:${first.id}:${second.id}`,
          entityType: type,
          records: [first, second].map((row) => ({
            id: String(row.id),
            version: Number(row.version),
            label:
              type === "company"
                ? String(row.name)
                : `${row.first_name} ${row.last_name}`,
          })),
          triggers: matches.map((field) => ({
            field,
            normalizedValue: a[field as keyof typeof a],
          })),
        });
    }
  return output;
}
function resolve(
  database: DatabaseSync,
  organizationId: string,
  type: EntityType,
  id: string,
) {
  const seen = new Set<string>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const row = database
      .prepare(
        "SELECT survivor_id FROM merge_redirects WHERE organization_id=? AND entity_type=? AND retired_id=?",
      )
      .get(organizationId, type, current) as Row | undefined;
    if (!row) return current;
    current = String(row.survivor_id);
  }
  throw new MergeError(
    409,
    "INVALID_REDIRECT_CHAIN",
    "The merge redirect chain is invalid.",
  );
}
function send(error: unknown, response: Response) {
  if (error instanceof MergeError)
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(error.code === "forbidden" ? 403 : 401)
      .json({ error: { code: error.code, message: error.message } });
  else throw error;
}

export function createDuplicatesRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router();
  const auth = new AuthService(new SqliteAuthRepository(database));
  const principal = (request: Request) =>
    auth.authenticate(readSessionCookie(request.header("cookie")));
  const mutate = async (request: Request) => {
    const user = await principal(request);
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
  router.get("/:entityType", async (request, response) => {
    try {
      const user = await principal(request),
        type = typeOf(request.params.entityType),
        definition = definitions[type];
      const rows = database
        .prepare(
          `SELECT * FROM ${definition.table} WHERE organization_id=? AND archived_at IS NULL ORDER BY id`,
        )
        .all(user.organizationId) as Row[];
      response.json({
        entityType: type,
        candidates: candidates(type, rows),
        automaticMerges: 0,
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.get("/:entityType/redirects/:id", async (request, response) => {
    try {
      const user = await principal(request),
        type = typeOf(request.params.entityType),
        survivorId = resolve(
          database,
          user.organizationId,
          type,
          request.params.id,
        );
      if (survivorId === request.params.id)
        throw new MergeError(
          404,
          "NOT_FOUND",
          "No merge redirect exists for this identifier.",
        );
      response.json({
        entityType: type,
        retiredId: request.params.id,
        survivorId,
      });
    } catch (error) {
      send(error, response);
    }
  });
  router.post("/:entityType/merge", async (request, response) => {
    try {
      const user = await mutate(request),
        type = typeOf(request.params.entityType),
        definition = definitions[type];
      const body = request.body as Row,
        key =
          typeof body.idempotencyKey === "string"
            ? body.idempotencyKey.trim()
            : "";
      if (!key || key.length > 200)
        throw new MergeError(
          400,
          "VALIDATION",
          "An idempotency key is required.",
        );
      const replay = database
        .prepare(
          "SELECT * FROM merge_operations WHERE organization_id=? AND idempotency_key=?",
        )
        .get(user.organizationId, key) as Row | undefined;
      if (replay)
        return response.json({
          operationId: replay.id,
          entityType: replay.entity_type,
          retiredId: replay.retired_id,
          survivorId: replay.survivor_id,
          replayed: true,
        });
      const requestedSurvivor = String(body.survivorId ?? ""),
        requestedRetired = String(body.retiredId ?? "");
      const survivorId = resolve(
        database,
        user.organizationId,
        type,
        requestedSurvivor,
      );
      if (!requestedRetired || survivorId === requestedRetired)
        throw new MergeError(
          400,
          "VALIDATION",
          "Choose two different records and a survivor.",
        );
      if (
        resolve(database, user.organizationId, type, requestedRetired) !==
        requestedRetired
      )
        throw new MergeError(
          409,
          "ALREADY_MERGED",
          "The retired record was already merged.",
        );
      const survivor = database
        .prepare(
          `SELECT * FROM ${definition.table} WHERE organization_id=? AND id=?`,
        )
        .get(user.organizationId, survivorId) as Row | undefined;
      const retired = database
        .prepare(
          `SELECT * FROM ${definition.table} WHERE organization_id=? AND id=?`,
        )
        .get(user.organizationId, requestedRetired) as Row | undefined;
      if (!survivor || !retired)
        throw new MergeError(
          404,
          "NOT_FOUND",
          "Both records must exist in this organization.",
        );
      if (survivor.archived_at || retired.archived_at)
        throw new MergeError(
          409,
          "ARCHIVED_RECORD",
          "Archived records cannot be merged or selected as survivors.",
        );
      if (
        Number(body.survivorVersion) !== Number(survivor.version) ||
        Number(body.retiredVersion) !== Number(retired.version)
      )
        throw new MergeError(
          409,
          "EDIT_CONFLICT",
          "A record changed during review. Reload the candidate before merging.",
        );
      const fields = body.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields))
        throw new MergeError(
          400,
          "UNRESOLVED_FIELDS",
          "Resolve every mutable field before merging.",
        );
      const decisions = fields as Row;
      const missing = definition.fields.filter(
        (field) => !(field in decisions),
      );
      const unknown = Object.keys(decisions).filter(
        (field) => !(definition.fields as readonly string[]).includes(field),
      );
      if (missing.length || unknown.length)
        throw new MergeError(
          400,
          "UNRESOLVED_FIELDS",
          `Resolve exactly these mutable fields: ${definition.fields.join(", ")}.`,
        );
      const now = new Date().toISOString(),
        operationId = randomUUID();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = database
          .prepare(
            `SELECT version,archived_at FROM ${definition.table} WHERE organization_id=? AND id=?`,
          )
          .get(user.organizationId, survivorId) as Row;
        const old = database
          .prepare(
            `SELECT version,archived_at FROM ${definition.table} WHERE organization_id=? AND id=?`,
          )
          .get(user.organizationId, requestedRetired) as Row;
        if (
          Number(current.version) !== Number(body.survivorVersion) ||
          Number(old.version) !== Number(body.retiredVersion) ||
          current.archived_at ||
          old.archived_at
        )
          throw new MergeError(
            409,
            "EDIT_CONFLICT",
            "A record changed during review. Reload the candidate before merging.",
          );
        if (type === "company") {
          for (const table of ["contacts", "deals", "activities", "tasks"])
            database
              .prepare(
                `UPDATE ${table} SET company_id=? WHERE organization_id=? AND company_id=?`,
              )
              .run(survivorId, user.organizationId, requestedRetired);
          database
            .prepare(
              "UPDATE companies SET organization_number=NULL,external_reference=NULL WHERE organization_id=? AND id=?",
            )
            .run(user.organizationId, requestedRetired);
        } else {
          database
            .prepare(
              "INSERT OR IGNORE INTO deal_contacts(organization_id,deal_id,contact_id,created_at) SELECT organization_id,deal_id,?,created_at FROM deal_contacts WHERE organization_id=? AND contact_id=?",
            )
            .run(survivorId, user.organizationId, requestedRetired);
          database
            .prepare(
              "DELETE FROM deal_contacts WHERE organization_id=? AND contact_id=?",
            )
            .run(user.organizationId, requestedRetired);
          database
            .prepare(
              "INSERT OR IGNORE INTO activity_participants(organization_id,activity_id,contact_id,display_name_snapshot) SELECT organization_id,activity_id,?,display_name_snapshot FROM activity_participants WHERE organization_id=? AND contact_id=?",
            )
            .run(survivorId, user.organizationId, requestedRetired);
          database
            .prepare(
              "DELETE FROM activity_participants WHERE organization_id=? AND contact_id=?",
            )
            .run(user.organizationId, requestedRetired);
          for (const table of ["activities", "tasks"])
            database
              .prepare(
                `UPDATE ${table} SET contact_id=? WHERE organization_id=? AND contact_id=?`,
              )
              .run(survivorId, user.organizationId, requestedRetired);
        }
        const values = definition.fields.map((field) =>
          field === "tags_json" && !Array.isArray(decisions[field])
            ? decisions[field]
            : field === "tags_json"
              ? JSON.stringify(decisions[field])
              : decisions[field] === undefined
                ? null
                : decisions[field],
        );
        database
          .prepare(
            `UPDATE ${definition.table} SET ${definition.fields.map((field) => `${field}=?`).join(",")},updated_at=?,version=version+1 WHERE organization_id=? AND id=?`,
          )
          .run(...(values as never[]), now, user.organizationId, survivorId);
        database
          .prepare(
            `UPDATE ${definition.table} SET archived_at=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=?`,
          )
          .run(now, now, user.organizationId, requestedRetired);
        database
          .prepare(
            "UPDATE merge_redirects SET survivor_id=? WHERE organization_id=? AND entity_type=? AND survivor_id=?",
          )
          .run(survivorId, user.organizationId, type, requestedRetired);
        database
          .prepare(
            "INSERT INTO merge_redirects(organization_id,entity_type,retired_id,survivor_id,merged_by,merged_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            user.organizationId,
            type,
            requestedRetired,
            survivorId,
            user.userId,
            now,
          );
        database
          .prepare(
            "INSERT INTO merge_operations(id,organization_id,entity_type,idempotency_key,retired_id,survivor_id,decisions_json,actor_id,merged_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            operationId,
            user.organizationId,
            type,
            key,
            requestedRetired,
            survivorId,
            JSON.stringify(decisions),
            user.userId,
            now,
          );
        database
          .prepare(
            "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            user.organizationId,
            user.userId,
            `${type}.merged`,
            type,
            survivorId,
            operationId,
            JSON.stringify({
              retiredId: requestedRetired,
              survivorId,
              fields: definition.fields,
            }),
            now,
          );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(201).json({
        operationId,
        entityType: type,
        retiredId: requestedRetired,
        survivorId,
        replayed: false,
      });
    } catch (error) {
      send(error, response);
    }
  });
  return router;
}
