import { createHash, randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Resource = "companies" | "contacts";
type Row = Record<string, unknown>;
type PreviewRow = {
  rowNumber: number;
  status: "valid" | "warning" | "invalid" | "committed";
  normalized: Record<string, string | string[] | null>;
  errors: string[];
  warnings: string[];
};

const MAX_CSV_BYTES = 512 * 1024;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 50;
const resources: Resource[] = ["companies", "contacts"];
export const importFields = {
  companies: [
    "name",
    "organizationNumber",
    "externalReference",
    "website",
    "phone",
    "industry",
    "size",
    "lifecycleStatus",
    "tags",
    "description",
  ],
  contacts: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "jobTitle",
    "status",
    "tags",
    "communicationPreference",
    "companyOrganizationNumber",
  ],
} satisfies Record<Resource, string[]>;

const fail = (status: 400 | 409, code: string, message: string) =>
  new AuthError(status, code, message);

export function parseCsv(csv: string): string[][] {
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES)
    throw fail(400, "CSV_TOO_LARGE", "CSV files must be 512 KB or smaller.");
  if (!csv || csv.includes("\uFFFD") || csv.includes("\0"))
    throw fail(400, "MALFORMED_CSV", "Upload a valid UTF-8 CSV file.");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      if (field)
        throw fail(400, "MALFORMED_CSV", "A quoted field is malformed.");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw fail(400, "MALFORMED_CSV", "A quoted field is not closed.");
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  if (rows.length < 2)
    throw fail(400, "EMPTY_CSV", "Include a header and at least one data row.");
  if (rows.length - 1 > MAX_ROWS)
    throw fail(
      400,
      "CSV_TOO_LARGE",
      `CSV files may contain at most ${MAX_ROWS} data rows.`,
    );
  if (rows[0].length > MAX_COLUMNS)
    throw fail(
      400,
      "CSV_TOO_WIDE",
      `CSV files may contain at most ${MAX_COLUMNS} columns.`,
    );
  const width = rows[0].length;
  if (
    new Set(rows[0].map((value) => value.trim().toLowerCase())).size !== width
  )
    throw fail(400, "DUPLICATE_HEADERS", "CSV headers must be unique.");
  if (rows.some((candidate) => candidate.length !== width))
    throw fail(
      400,
      "MALFORMED_CSV",
      "Every CSV row must have the same number of columns.",
    );
  return rows;
}

const clean = (value: string | undefined, maximum: number) => {
  const normalized = value?.trim() ?? "";
  return normalized.length <= maximum ? normalized : null;
};
const tags = (value = "") => [
  ...new Set(
    value
      .split(/[|;]/u)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  ),
];
const mapped = (
  headers: string[],
  values: string[],
  mapping: Record<string, string>,
  field: string,
) => {
  const source = mapping[field];
  const index = source ? headers.indexOf(source) : -1;
  return index < 0 ? "" : values[index];
};

function normalizeRow(
  resource: Resource,
  headers: string[],
  values: string[],
  mapping: Record<string, string>,
  database: SqliteDatabase,
  organizationId: string,
  rowNumber: number,
): PreviewRow {
  const get = (field: string) => mapped(headers, values, mapping, field);
  const errors: string[] = [],
    warnings: string[] = [];
  const normalized: Record<string, string | string[] | null> = {};
  if (resource === "companies") {
    for (const [field, max] of [
      ["name", 160],
      ["organizationNumber", 100],
      ["externalReference", 100],
      ["website", 300],
      ["phone", 80],
      ["industry", 100],
      ["size", 80],
      ["description", 5000],
    ] as const) {
      const value = clean(get(field), max);
      if (value === null) errors.push(`${field} is too long.`);
      normalized[field] = value || null;
    }
    if (!normalized.name) errors.push("Company name is required.");
    const lifecycle = get("lifecycleStatus").trim().toLowerCase() || "lead";
    if (!["lead", "prospect", "customer", "inactive"].includes(lifecycle))
      errors.push("Lifecycle must be lead, prospect, customer, or inactive.");
    normalized.lifecycleStatus = lifecycle;
    normalized.tags = tags(get("tags"));
    if (
      (normalized.tags as string[]).length > 20 ||
      (normalized.tags as string[]).some((tag) => tag.length > 40)
    )
      errors.push("Use at most 20 tags of 40 characters each.");
    if (
      normalized.website &&
      !/^https?:\/\/[^\s]+$/iu.test(String(normalized.website))
    )
      errors.push("Website must begin with http:// or https://.");
    const nameMatch = database
      .prepare(
        "SELECT name FROM companies WHERE organization_id=? AND lower(name)=lower(?) AND archived_at IS NULL",
      )
      .get(organizationId, normalized.name) as Row | undefined;
    if (nameMatch)
      warnings.push(`Name matches existing company ${String(nameMatch.name)}.`);
    for (const [field, column] of [
      ["organizationNumber", "organization_number"],
      ["externalReference", "external_reference"],
    ] as const)
      if (normalized[field]) {
        const match = database
          .prepare(
            `SELECT name FROM companies WHERE organization_id=? AND ${column}=?`,
          )
          .get(organizationId, normalized[field]) as Row | undefined;
        if (match)
          errors.push(
            `${field} matches existing company ${String(match.name)}.`,
          );
      }
  } else {
    for (const [field, max] of [
      ["firstName", 80],
      ["lastName", 80],
      ["email", 254],
      ["phone", 50],
      ["jobTitle", 120],
      ["companyOrganizationNumber", 100],
    ] as const) {
      const value = clean(get(field), max);
      if (value === null) errors.push(`${field} is too long.`);
      normalized[field] = value || null;
    }
    if (!normalized.firstName || !normalized.lastName)
      errors.push("First and last name are required.");
    if (normalized.email)
      normalized.email = String(normalized.email).toLowerCase();
    if (normalized.email && !/^\S+@\S+\.\S+$/u.test(String(normalized.email)))
      errors.push("Email is invalid.");
    const status = get("status").trim().toLowerCase() || "active";
    if (!["lead", "active", "inactive"].includes(status))
      errors.push("Status must be lead, active, or inactive.");
    normalized.status = status;
    const preference =
      get("communicationPreference").trim().toLowerCase() || "email";
    if (!["email", "phone", "none"].includes(preference))
      errors.push("Communication preference must be email, phone, or none.");
    normalized.communicationPreference = preference;
    normalized.tags = tags(get("tags"));
    if (
      (normalized.tags as string[]).length > 20 ||
      (normalized.tags as string[]).some((tag) => tag.length > 40)
    )
      errors.push("Use at most 20 tags of 40 characters each.");
    if (normalized.email) {
      const match = database
        .prepare(
          "SELECT first_name,last_name FROM contacts WHERE organization_id=? AND email=? COLLATE NOCASE AND archived_at IS NULL",
        )
        .get(organizationId, normalized.email) as Row | undefined;
      if (match)
        warnings.push(
          `Email matches existing contact ${String(match.first_name)} ${String(match.last_name)}.`,
        );
    }
    if (
      normalized.companyOrganizationNumber &&
      !database
        .prepare(
          "SELECT 1 FROM companies WHERE organization_id=? AND organization_number=? AND archived_at IS NULL",
        )
        .get(organizationId, normalized.companyOrganizationNumber)
    )
      errors.push("Related company organization number was not found.");
  }
  return {
    rowNumber,
    status: errors.length ? "invalid" : warnings.length ? "warning" : "valid",
    normalized,
    errors,
    warnings,
  };
}

const escapeCsv = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[\t ]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function importsRouter(database: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const authenticate = async (request: Request, mutable = false) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      mutable ? ["owner", "member"] : ["owner", "member", "viewer"],
    );
  router.post("/preview", async (request, response, next) => {
    try {
      const user = await authenticate(request, true);
      const body = request.body as Row | undefined;
      if (
        !resources.includes(body?.resource as Resource) ||
        typeof body?.csv !== "string" ||
        !body.mapping ||
        typeof body.mapping !== "object" ||
        Array.isArray(body.mapping)
      )
        throw fail(
          400,
          "VALIDATION_ERROR",
          "Choose a resource, CSV file, and column mapping.",
        );
      const resource = body.resource as Resource;
      const csvRows = parseCsv(body.csv);
      const headers = csvRows[0].map((header) => header.trim());
      const mapping = body.mapping as Record<string, string>;
      if (
        Object.keys(mapping).some(
          (field) => !importFields[resource].includes(field),
        ) ||
        Object.values(mapping).some((header) => !headers.includes(header)) ||
        new Set(Object.values(mapping)).size !== Object.values(mapping).length
      )
        throw fail(
          400,
          "INVALID_MAPPING",
          "Map supported fields to unique CSV headers.",
        );
      const required =
        resource === "companies" ? ["name"] : ["firstName", "lastName"];
      if (required.some((field) => !mapping[field]))
        throw fail(
          400,
          "INVALID_MAPPING",
          `Map required fields: ${required.join(", ")}.`,
        );
      const preview = csvRows
        .slice(1)
        .map((values, index) =>
          normalizeRow(
            resource,
            headers,
            values,
            mapping,
            database,
            user.organization.id,
            index + 2,
          ),
        );
      for (const field of resource === "companies"
        ? ["organizationNumber", "externalReference"]
        : ["email"]) {
        const seen = new Map<string, PreviewRow>();
        for (const row of preview) {
          const value = row.normalized[field];
          if (!value || Array.isArray(value)) continue;
          const normalized = value.toLowerCase();
          const priorRow = seen.get(normalized);
          if (priorRow) {
            const message = `${field} is repeated in CSV rows ${priorRow.rowNumber} and ${row.rowNumber}.`;
            if (resource === "companies") {
              priorRow.errors.push(message);
              row.errors.push(message);
            } else {
              priorRow.warnings.push(message);
              row.warnings.push(message);
            }
          } else seen.set(normalized, row);
        }
      }
      for (const row of preview)
        row.status = row.errors.length
          ? "invalid"
          : row.warnings.length
            ? "warning"
            : "valid";
      const hash = createHash("sha256")
        .update(JSON.stringify({ resource, csv: body.csv, mapping }))
        .digest("hex");
      const now = new Date().toISOString();
      const prior = database
        .prepare(
          "SELECT id,status FROM imports WHERE organization_id=? AND content_hash=? AND resource=?",
        )
        .get(user.organization.id, hash, resource) as Row | undefined;
      const id = prior ? String(prior.id) : randomUUID();
      if (!prior) {
        database.exec("BEGIN IMMEDIATE");
        try {
          database
            .prepare(
              "INSERT INTO imports(id,organization_id,creator_membership_id,resource,status,content_hash,mapping_json,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              id,
              user.organization.id,
              user.membershipId,
              resource,
              "preview",
              hash,
              JSON.stringify(mapping),
              JSON.stringify({}),
              now,
            );
          const insert = database.prepare(
            "INSERT INTO import_rows(id,import_id,row_number,status,normalized_json,errors_json) VALUES(?,?,?,?,?,?)",
          );
          for (const row of preview)
            insert.run(
              randomUUID(),
              id,
              row.rowNumber,
              row.status,
              JSON.stringify(row.normalized),
              JSON.stringify([...row.errors, ...row.warnings]),
            );
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }
      const summary = {
        total: preview.length,
        valid: preview.filter((row) => row.status === "valid").length,
        warnings: preview.filter((row) => row.status === "warning").length,
        invalid: preview.filter((row) => row.status === "invalid").length,
        commitPolicy:
          "Valid rows and acknowledged warning rows are committed; invalid rows remain reported and unchanged.",
      };
      response.json({
        importId: id,
        resource,
        headers,
        mapping,
        status: prior?.status ?? "preview",
        rows: preview,
        summary,
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:importId/commit", async (request, response, next) => {
    try {
      const user = await authenticate(request, true);
      const record = database
        .prepare("SELECT * FROM imports WHERE id=? AND organization_id=?")
        .get(String(request.params.importId), user.organization.id) as
        Row | undefined;
      if (!record)
        throw fail(400, "IMPORT_NOT_FOUND", "Import preview not found.");
      if (record.status === "committed")
        return response.json({
          importId: record.id,
          status: "committed",
          summary: JSON.parse(String(record.summary_json)),
          replayed: true,
        });
      const rows = database
        .prepare(
          "SELECT * FROM import_rows WHERE import_id=? AND status IN ('valid','warning') ORDER BY row_number",
        )
        .all(record.id) as Row[];
      const now = new Date().toISOString();
      let committed = 0;
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const stored of rows) {
          const value = JSON.parse(String(stored.normalized_json)) as Record<
            string,
            unknown
          >;
          const entityId = randomUUID();
          if (record.resource === "companies")
            database
              .prepare(
                "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address_json,lifecycle_status,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              )
              .run(
                entityId,
                user.organization.id,
                value.name,
                value.organizationNumber,
                value.externalReference,
                value.website,
                value.phone,
                value.industry,
                value.size,
                "{}",
                value.lifecycleStatus,
                JSON.stringify(value.tags),
                value.description ?? "",
                now,
                now,
              );
          else {
            const company = value.companyOrganizationNumber
              ? (database
                  .prepare(
                    "SELECT id FROM companies WHERE organization_id=? AND organization_number=? AND archived_at IS NULL",
                  )
                  .get(
                    user.organization.id,
                    value.companyOrganizationNumber,
                  ) as Row | undefined)
              : undefined;
            database
              .prepare(
                "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,email,phone,job_title,status,tags_json,communication_preference,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
              )
              .run(
                entityId,
                user.organization.id,
                company?.id ?? null,
                value.firstName,
                value.lastName,
                value.email,
                value.phone,
                value.jobTitle,
                value.status,
                JSON.stringify(value.tags),
                value.communicationPreference,
                now,
                now,
              );
          }
          database
            .prepare(
              "UPDATE import_rows SET status='committed',entity_id=? WHERE id=?",
            )
            .run(entityId, stored.id);
          committed += 1;
        }
        const invalid = Number(
          (
            database
              .prepare(
                "SELECT count(*) count FROM import_rows WHERE import_id=? AND status='invalid'",
              )
              .get(record.id) as Row
          ).count,
        );
        const summary = { committed, invalid, total: committed + invalid };
        database
          .prepare(
            "UPDATE imports SET status='committed',summary_json=?,committed_at=? WHERE id=?",
          )
          .run(JSON.stringify(summary), now, record.id);
        database
          .prepare(
            "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            user.organization.id,
            user.membershipId,
            "import.committed",
            "import",
            record.id,
            randomUUID(),
            JSON.stringify({ resource: record.resource, committed, invalid }),
            now,
          );
        database.exec("COMMIT");
        response.json({
          importId: record.id,
          status: "committed",
          summary,
          replayed: false,
        });
      } catch (error) {
        database.exec("ROLLBACK");
        if (
          error instanceof Error &&
          /UNIQUE constraint failed/iu.test(error.message)
        )
          throw fail(
            409,
            "IMPORT_CONFLICT",
            "A duplicate changed after preview. Preview the CSV again.",
          );
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });
  router.get("/export/:resource.csv", async (request, response, next) => {
    try {
      const user = await authenticate(request);
      const resource = request.params.resource as Resource;
      if (!resources.includes(resource))
        throw fail(400, "VALIDATION_ERROR", "Choose companies or contacts.");
      const conditions = ["c.organization_id=?", "c.archived_at IS NULL"];
      const parameters: unknown[] = [user.organization.id];
      if (typeof request.query.q === "string" && request.query.q.trim()) {
        const term = `%${request.query.q.trim().replace(/[\\%_]/gu, "\\$&")}%`;
        if (resource === "companies") {
          conditions.push(
            "(c.name LIKE ? ESCAPE '\\' OR c.organization_number LIKE ? ESCAPE '\\' OR c.external_reference LIKE ? ESCAPE '\\')",
          );
          parameters.push(term, term, term);
        } else {
          conditions.push(
            "(c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')",
          );
          parameters.push(term, term, term);
        }
      }
      const exact =
        resource === "companies"
          ? [
              ["lifecycle", "c.lifecycle_status"],
              ["industry", "c.industry"],
              ["size", "c.size"],
              ["owner", "c.owner_membership_id"],
            ]
          : [
              ["status", "c.status"],
              ["companyId", "c.company_id"],
              ["ownerId", "c.owner_membership_id"],
            ];
      for (const [query, column] of exact)
        if (typeof request.query[query] === "string" && request.query[query]) {
          conditions.push(`${column}=?`);
          parameters.push(request.query[query]);
        }
      if (typeof request.query.tag === "string" && request.query.tag) {
        conditions.push(
          "EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE lower(value)=lower(?))",
        );
        parameters.push(request.query.tag);
      }
      const columns =
        resource === "companies"
          ? [
              ["name", "name"],
              ["organization_number", "organization_number"],
              ["external_reference", "external_reference"],
              ["website", "website"],
              ["phone", "phone"],
              ["industry", "industry"],
              ["size", "size"],
              ["lifecycle_status", "lifecycle_status"],
              ["tags_json", "tags"],
              ["description", "description"],
            ]
          : [
              ["first_name", "first_name"],
              ["last_name", "last_name"],
              ["email", "email"],
              ["phone", "phone"],
              ["job_title", "job_title"],
              ["status", "status"],
              ["communication_preference", "communication_preference"],
              ["tags_json", "tags"],
              ["company_organization_number", "company_organization_number"],
            ];
      const select = columns
        .map(([column]) =>
          column === "company_organization_number"
            ? "co.organization_number company_organization_number"
            : `c.${column}`,
        )
        .join(",");
      const from =
        resource === "companies"
          ? "companies c"
          : "contacts c LEFT JOIN companies co ON co.id=c.company_id AND co.organization_id=c.organization_id";
      const rows = database
        .prepare(
          `SELECT ${select} FROM ${from} WHERE ${conditions.join(" AND ")} ORDER BY ${resource === "companies" ? "c.name" : "c.last_name,c.first_name"},c.id`,
        )
        .all(...parameters) as Row[];
      const csv =
        [
          columns.map(([, header]) => header).join(","),
          ...rows.map((row) =>
            columns
              .map(([column]) =>
                escapeCsv(
                  column === "tags_json"
                    ? (JSON.parse(String(row[column])) as string[]).join(";")
                    : row[column],
                ),
              )
              .join(","),
          ),
        ].join("\r\n") + "\r\n";
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="northstar-${resource}.csv"`,
      );
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
