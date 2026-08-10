import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
import type { Principal } from "../auth/types.js";
import { CsvError, csvDocument, parseCsv } from "./csv.js";

type Row = Record<string, unknown>;
type ImportKind = "companies" | "contacts";
type PreviewRow = {
  row: number;
  values: Record<string, string | null | string[]>;
  errors: string[];
  warnings: string[];
};
const targets = {
  companies: [
    "name",
    "organizationNumber",
    "externalReference",
    "website",
    "phone",
    "industry",
    "size",
    "address",
    "lifecycleStatus",
    "ownerId",
    "tags",
    "description",
  ],
  contacts: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "jobTitle",
    "ownerId",
    "status",
    "tags",
    "communicationPreference",
    "companyId",
  ],
} as const;

const clean = (value: string | undefined, maximum = 500) =>
  (value ?? "").trim().slice(0, maximum);
const formula = (value: string) => /^[=+\-@]/u.test(value.trim());
function mapRows(
  kind: ImportKind,
  rows: string[][],
  mapping: Record<string, string>,
  database: DatabaseSync,
  user: Principal,
): PreviewRow[] {
  const headers = rows[0]!;
  const indices = new Map(headers.map((header, index) => [header, index]));
  const allowed = new Set<string>(targets[kind]);
  if (Object.keys(mapping).some((target) => !allowed.has(target)))
    throw new CsvError("The mapping contains an unsupported target field.");
  const effective = Object.keys(mapping).length
    ? mapping
    : Object.fromEntries(
        headers
          .filter((header) => allowed.has(header))
          .map((header) => [header, header]),
      );
  if (Object.values(effective).some((header) => !indices.has(header)))
    throw new CsvError(
      "Every mapped source column must exist in the CSV header.",
    );
  const required = kind === "companies" ? ["name"] : ["firstName", "lastName"];
  if (required.some((target) => !effective[target]))
    throw new CsvError(
      `Map the required ${required.join(" and ")} field${required.length > 1 ? "s" : ""}.`,
    );
  return rows.slice(1).map((cells, rowIndex) => {
    const raw = Object.fromEntries(
      Object.entries(effective).map(([target, header]) => [
        target,
        cells[indices.get(header)!] ?? "",
      ]),
    );
    const errors: string[] = [],
      warnings: string[] = [];
    for (const [target, value] of Object.entries(raw))
      if (formula(value))
        errors.push(`${target} starts with a spreadsheet formula character.`);
    const values: Record<string, string | null | string[]> = {};
    if (kind === "companies") {
      values.name = clean(raw.name, 160);
      values.organizationNumber = clean(raw.organizationNumber, 100) || null;
      values.externalReference = clean(raw.externalReference, 100) || null;
      values.website = clean(raw.website, 300) || null;
      values.phone = clean(raw.phone, 80) || null;
      values.industry = clean(raw.industry, 100) || null;
      values.size = clean(raw.size, 80) || null;
      values.address = clean(raw.address, 500) || null;
      values.lifecycleStatus = clean(raw.lifecycleStatus, 40) || "prospect";
      values.ownerId = clean(raw.ownerId, 100) || null;
      values.tags = clean(raw.tags, 1000)
        .split(/[;|]/u)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20);
      values.description = clean(raw.description, 5000);
      if (!values.name) errors.push("Company name is required.");
      if (
        ![
          "lead",
          "prospect",
          "customer",
          "former_customer",
          "partner",
        ].includes(String(values.lifecycleStatus))
      )
        errors.push("Lifecycle status is invalid.");
      for (const [field, column] of [
        ["organizationNumber", "organization_number"],
        ["externalReference", "external_reference"],
      ] as const)
        if (
          values[field] &&
          database
            .prepare(
              `SELECT name FROM companies WHERE organization_id=? AND ${column}=?`,
            )
            .get(user.organizationId, values[field] as string)
        ) {
          warnings.push(`${field} already belongs to another company.`);
          errors.push(
            `${field} must be unique before this row can be committed.`,
          );
        }
    } else {
      values.firstName = clean(raw.firstName, 80);
      values.lastName = clean(raw.lastName, 80);
      values.email = clean(raw.email, 254).toLowerCase() || null;
      values.phone = clean(raw.phone, 50) || null;
      values.jobTitle = clean(raw.jobTitle, 120) || null;
      values.ownerId = clean(raw.ownerId, 100) || null;
      values.status = clean(raw.status, 40) || "active";
      values.tags = clean(raw.tags, 1000)
        .split(/[;|]/u)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
      values.communicationPreference =
        clean(raw.communicationPreference, 40) || "email";
      values.companyId = clean(raw.companyId, 100) || null;
      if (!values.firstName || !values.lastName)
        errors.push("First and last name are required.");
      if (values.email && !/^\S+@\S+\.\S+$/u.test(String(values.email)))
        errors.push("Email is invalid.");
      if (
        values.email &&
        database
          .prepare(
            "SELECT first_name,last_name FROM contacts WHERE organization_id=? AND email=? COLLATE NOCASE AND archived_at IS NULL",
          )
          .get(user.organizationId, values.email as string)
      )
        warnings.push("Email matches an existing contact.");
      if (
        !["active", "inactive", "do_not_contact"].includes(
          String(values.status),
        )
      )
        errors.push("Contact status is invalid.");
      if (
        !["email", "phone", "none"].includes(
          String(values.communicationPreference),
        )
      )
        errors.push("Communication preference is invalid.");
    }
    for (const relation of ["ownerId", "companyId"] as const)
      if (values[relation]) {
        const valid =
          relation === "ownerId"
            ? database
                .prepare(
                  "SELECT 1 FROM memberships WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
                )
                .get(user.organizationId, values[relation] as string)
            : database
                .prepare(
                  "SELECT 1 FROM companies WHERE organization_id=? AND id=?",
                )
                .get(user.organizationId, values[relation] as string);
        if (!valid)
          errors.push(
            `${relation} does not identify an accessible active record.`,
          );
      }
    return {
      row: rowIndex + 2,
      values,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
    };
  });
}

export function createImportsRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router(),
    auth = new AuthService(new SqliteAuthRepository(database));
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
  router.post("/preview", async (request, response, next) => {
    try {
      const user = await mutate(request),
        body = request.body as Record<string, unknown>,
        kind = body.kind;
      if (kind !== "companies" && kind !== "contacts")
        throw new AuthError("validation", "Choose companies or contacts.");
      if (typeof body.csv !== "string")
        throw new AuthError("validation", "Provide a UTF-8 CSV file.");
      const mapping =
        body.mapping && typeof body.mapping === "object"
          ? (body.mapping as Record<string, string>)
          : {};
      const sourceDigest = createHash("sha256")
          .update(`${kind}\0${body.csv}`, "utf8")
          .digest("hex"),
        key =
          typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
            ? body.idempotencyKey.trim().slice(0, 160)
            : sourceDigest;
      const existing = database
        .prepare(
          "SELECT * FROM imports WHERE organization_id=? AND idempotency_key=?",
        )
        .get(user.organizationId, key) as Row | undefined;
      if (existing) {
        if (existing.source_digest !== sourceDigest)
          throw new AuthError(
            "conflict",
            "That idempotency key was already used for different content.",
          );
        return response.json(importJson(existing));
      }
      const replay = database
        .prepare(
          "SELECT * FROM imports WHERE organization_id=? AND creator_id=? AND kind=? AND source_digest=?",
        )
        .get(user.organizationId, user.userId, kind, sourceDigest) as
        Row | undefined;
      if (replay) return response.json(importJson(replay));
      const preview = mapRows(
          kind,
          parseCsv(body.csv),
          mapping,
          database,
          user,
        ),
        now = new Date().toISOString(),
        id = randomUUID(),
        errors = preview.filter((row) => row.errors.length).length;
      database
        .prepare(
          "INSERT INTO imports(id,organization_id,creator_id,kind,idempotency_key,status,row_count,error_count,created_at,source_digest,mapping_json,preview_json) VALUES(?,?,?,?,?,'preview',?,?,?,?,?,?)",
        )
        .run(
          id,
          user.organizationId,
          user.userId,
          kind,
          key,
          preview.length,
          errors,
          now,
          sourceDigest,
          JSON.stringify(mapping),
          JSON.stringify(preview),
        );
      response
        .status(201)
        .json(
          importJson(
            database.prepare("SELECT * FROM imports WHERE id=?").get(id) as Row,
          ),
        );
    } catch (error) {
      if (error instanceof CsvError)
        next(new AuthError("validation", error.message));
      else next(error);
    }
  });
  router.post("/:id/commit", async (request, response, next) => {
    try {
      const user = await mutate(request),
        record = database
          .prepare("SELECT * FROM imports WHERE id=? AND organization_id=?")
          .get(request.params.id, user.organizationId) as Row | undefined;
      if (!record)
        return response
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Import not found." } });
      if (record.status === "committed")
        return response.json(importJson(record));
      const preview = JSON.parse(String(record.preview_json)) as PreviewRow[],
        valid = preview.filter((row) => !row.errors.length);
      if (!valid.length)
        throw new AuthError(
          "conflict",
          "Fix the row errors before committing this import.",
        );
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const row of valid)
          insertRow(
            database,
            String(record.kind) as ImportKind,
            user,
            row.values,
            now,
          );
        database
          .prepare(
            "UPDATE imports SET status='committed',committed_at=? WHERE id=? AND status='preview'",
          )
          .run(now, String(record.id));
        database
          .prepare(
            "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            user.organizationId,
            user.userId,
            "import.committed",
            "import",
            String(record.id),
            String(response.locals.requestId),
            JSON.stringify({
              kind: record.kind,
              validRows: valid.length,
              errorRows: preview.length - valid.length,
            }),
            now,
          );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        if (
          error instanceof Error &&
          /UNIQUE constraint failed/u.test(error.message)
        )
          throw new AuthError(
            "conflict",
            "CRM data changed after preview. Preview the file again before committing.",
          );
        throw error;
      }
      response.json(
        importJson(
          database
            .prepare("SELECT * FROM imports WHERE id=?")
            .get(String(record.id)) as Row,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/exports/:kind.csv", async (request, response, next) => {
    try {
      const user = await principal(request),
        kind = request.params.kind;
      if (kind !== "companies" && kind !== "contacts")
        return response.status(404).end();
      const { columns, rows } = exportRows(
        database,
        kind,
        user,
        request.query as Record<string, string>,
      );
      response
        .type("text/csv")
        .setHeader(
          "content-disposition",
          `attachment; filename="northstar-${kind}.csv"`,
        );
      response.send(csvDocument(columns, rows));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function importJson(row: Row) {
  const preview = JSON.parse(String(row.preview_json)) as PreviewRow[];
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status),
    rowCount: Number(row.row_count),
    validCount: preview.filter((item) => !item.errors.length).length,
    errorCount: Number(row.error_count),
    rows: preview,
    committedAt: row.committed_at ? String(row.committed_at) : null,
  };
}
function insertRow(
  db: DatabaseSync,
  kind: ImportKind,
  user: Principal,
  v: Record<string, string | null | string[]>,
  now: string,
) {
  const id = randomUUID();
  if (kind === "companies")
    db.prepare(
      "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address,lifecycle_status,owner_id,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      user.organizationId,
      v.name as string,
      v.organizationNumber as string | null,
      v.externalReference as string | null,
      v.website as string | null,
      v.phone as string | null,
      v.industry as string | null,
      v.size as string | null,
      v.address as string | null,
      v.lifecycleStatus as string,
      v.ownerId as string | null,
      JSON.stringify(v.tags),
      v.description as string,
      now,
      now,
    );
  else
    db.prepare(
      "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,email,phone,job_title,owner_id,status,tags_json,communication_preference,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      user.organizationId,
      v.companyId as string | null,
      v.firstName as string,
      v.lastName as string,
      v.email as string | null,
      v.phone as string | null,
      v.jobTitle as string | null,
      v.ownerId as string | null,
      v.status as string,
      JSON.stringify(v.tags),
      v.communicationPreference as string,
      now,
      now,
    );
}
function exportRows(
  db: DatabaseSync,
  kind: ImportKind,
  user: Principal,
  query: Record<string, string>,
) {
  const table = kind,
    where = ["organization_id=?"],
    values: SQLInputValue[] = [user.organizationId];
  if (query.archived !== "true") where.push("archived_at IS NULL");
  const q = query.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/gu, "\\$&")}%`;
    if (kind === "companies") {
      where.push(
        "(name LIKE ? ESCAPE '\\' OR organization_number LIKE ? ESCAPE '\\' OR external_reference LIKE ? ESCAPE '\\')",
      );
      values.push(pattern, pattern, pattern);
    } else {
      where.push(
        "(first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')",
      );
      values.push(pattern, pattern, pattern);
    }
  }
  const filters: Array<[string, string]> =
    kind === "companies"
      ? [
          ["lifecycle", "lifecycle_status"],
          ["owner", "owner_id"],
          ["industry", "industry"],
          ["size", "size"],
        ]
      : [
          ["companyId", "company_id"],
          ["ownerId", "owner_id"],
          ["status", "status"],
        ];
  for (const [key, column] of filters)
    if (query[key]) {
      where.push(`${column}=?`);
      values.push(query[key]!);
    }
  if (query.tag) {
    where.push(
      "EXISTS (SELECT 1 FROM json_each(tags_json) WHERE lower(value)=lower(?))",
    );
    values.push(query.tag);
  }
  if (
    kind === "companies" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(query.staleBefore ?? "")
  ) {
    if (!query.lifecycle)
      where.push("lifecycle_status IN ('prospect','customer')");
    where.push(
      "NOT EXISTS (SELECT 1 FROM activities a WHERE a.organization_id=companies.organization_id AND a.company_id=companies.id AND a.occurred_at>=?)",
    );
    values.push(`${query.staleBefore}T00:00:00.000Z`);
  }
  if (kind === "companies") {
    const columns = [
      "id",
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
      "tags",
      "description",
      "created_at",
      "updated_at",
    ];
    const rows = db
      .prepare(
        `SELECT id,name,organization_number,external_reference,website,phone,industry,size,address,lifecycle_status,owner_id,tags_json,description,created_at,updated_at FROM ${table} WHERE ${where.join(" AND ")} ORDER BY name,id`,
      )
      .all(...values) as Row[];
    return {
      columns,
      rows: rows.map((r) => [
        r.id,
        r.name,
        r.organization_number,
        r.external_reference,
        r.website,
        r.phone,
        r.industry,
        r.size,
        r.address,
        r.lifecycle_status,
        r.owner_id,
        (JSON.parse(String(r.tags_json)) as string[]).join(";"),
        r.description,
        r.created_at,
        r.updated_at,
      ]),
    };
  }
  const columns = [
    "id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "job_title",
    "company_id",
    "owner_id",
    "status",
    "tags",
    "communication_preference",
    "created_at",
    "updated_at",
  ];
  const rows = db
    .prepare(
      `SELECT id,first_name,last_name,email,phone,job_title,company_id,owner_id,status,tags_json,communication_preference,created_at,updated_at FROM ${table} WHERE ${where.join(" AND ")} ORDER BY last_name,first_name,id`,
    )
    .all(...values) as Row[];
  return {
    columns,
    rows: rows.map((r) => [
      r.id,
      r.first_name,
      r.last_name,
      r.email,
      r.phone,
      r.job_title,
      r.company_id,
      r.owner_id,
      r.status,
      (JSON.parse(String(r.tags_json)) as string[]).join(";"),
      r.communication_preference,
      r.created_at,
      r.updated_at,
    ]),
  };
}
