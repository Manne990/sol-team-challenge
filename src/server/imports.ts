import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
type Resource = "companies" | "contacts";
const fields = {
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
    "companyId",
  ],
} as const;
const required = { companies: ["name"], contacts: ["firstName", "lastName"] };
const formula = /^[=+\-@]/u;
function csvRows(csv: string) {
  if (Buffer.byteLength(csv, "utf8") > 1_000_000)
    throw new AuthError(
      400,
      "CSV_TOO_LARGE",
      "CSV files must be 1 MB or smaller.",
    );
  if (csv.includes("\0") || csv.includes("\uFFFD"))
    throw new AuthError(400, "MALFORMED_CSV", "Upload a valid UTF-8 CSV file.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted)
    throw new AuthError(
      400,
      "MALFORMED_CSV",
      "A quoted CSV field is not closed.",
    );
  if (cell || row.length) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  if (rows.length < 2)
    throw new AuthError(
      400,
      "MALFORMED_CSV",
      "CSV must contain a header and at least one data row.",
    );
  if (rows.length > 1001)
    throw new AuthError(
      400,
      "CSV_TOO_LARGE",
      "CSV imports support at most 1,000 data rows.",
    );
  const width = rows[0].length;
  if (width > 50 || rows.some((r) => r.length !== width))
    throw new AuthError(
      400,
      "MALFORMED_CSV",
      "Every CSV row must have the same number of columns.",
    );
  return rows;
}
const safe = (value: unknown) => {
  const text = String(value ?? "");
  const escaped = formula.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(escaped)
    ? `"${escaped.replaceAll('"', '""')}"`
    : escaped;
};
const normalizeTags = (value: string) =>
  [
    ...new Set(
      value
        .split(/[;,]/u)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 20);
function validate(
  resource: Resource,
  raw: Record<string, string>,
  db: SqliteDatabase,
  org: string,
) {
  const errors: string[] = [],
    warnings: string[] = [];
  for (const field of required[resource])
    if (!raw[field]?.trim()) errors.push(`${field} is required`);
  for (const [key, value] of Object.entries(raw))
    if (formula.test(value.trim()))
      errors.push(`${key} starts with a spreadsheet formula character`);
  if (resource === "companies") {
    const status = raw.lifecycleStatus?.trim() || "lead";
    if (!["lead", "prospect", "customer", "inactive"].includes(status))
      errors.push("lifecycleStatus is invalid");
    for (const [column, value, label] of [
      ["organization_number", raw.organizationNumber, "organization number"],
      ["external_reference", raw.externalReference, "external reference"],
    ] as const)
      if (
        value?.trim() &&
        db
          .prepare(
            `SELECT name FROM companies WHERE organization_id=? AND ${column}=?`,
          )
          .get(org, value.trim())
      )
        warnings.push(`Existing company has this ${label}`);
    return {
      normalized: {
        name: raw.name?.trim(),
        organizationNumber: raw.organizationNumber?.trim() || null,
        externalReference: raw.externalReference?.trim() || null,
        website: raw.website?.trim() || null,
        phone: raw.phone?.trim() || null,
        industry: raw.industry?.trim() || null,
        size: raw.size?.trim() || null,
        address: { formatted: raw.address?.trim() || "" },
        lifecycleStatus: status,
        tags: normalizeTags(raw.tags || ""),
        description: raw.description?.trim() || "",
      },
      errors,
      warnings,
    };
  }
  const email = raw.email?.trim().toLowerCase() || null;
  if (email && !/^\S+@\S+\.\S+$/u.test(email)) errors.push("email is invalid");
  if (
    email &&
    db
      .prepare(
        "SELECT 1 FROM contacts WHERE organization_id=? AND email=? COLLATE NOCASE AND archived_at IS NULL",
      )
      .get(org, email)
  )
    warnings.push("Existing contact has this normalized email");
  const status = raw.status?.trim() || "active",
    preference = raw.communicationPreference?.trim() || "email";
  if (!["lead", "active", "inactive"].includes(status))
    errors.push("status is invalid");
  if (!["email", "phone", "none"].includes(preference))
    errors.push("communicationPreference is invalid");
  if (
    raw.companyId?.trim() &&
    !db
      .prepare("SELECT 1 FROM companies WHERE id=? AND organization_id=?")
      .get(raw.companyId.trim(), org)
  )
    errors.push("companyId is unavailable");
  return {
    normalized: {
      firstName: raw.firstName?.trim(),
      lastName: raw.lastName?.trim(),
      email,
      phone: raw.phone?.trim() || null,
      jobTitle: raw.jobTitle?.trim() || null,
      status,
      tags: normalizeTags(raw.tags || ""),
      communicationPreference: preference,
      companyId: raw.companyId?.trim() || null,
    },
    errors,
    warnings,
  };
}

export function importsRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router();
  const actor = async (req: Request, write = false) =>
    auth.requireRole(
      await auth.authenticate(readCookie(req.headers.cookie, SESSION_COOKIE)),
      write ? ["owner", "member"] : ["owner", "member", "viewer"],
    );
  router.post("/preview", async (req, res, next) => {
    try {
      const user = await actor(req, true),
        body = req.body as Row,
        resource = body.resource as Resource;
      if (!fields[resource])
        throw new AuthError(
          400,
          "VALIDATION_ERROR",
          "Choose companies or contacts.",
        );
      if (
        typeof body.csv !== "string" ||
        !body.mapping ||
        typeof body.mapping !== "object"
      )
        throw new AuthError(
          400,
          "VALIDATION_ERROR",
          "Upload a CSV and map its columns.",
        );
      const parsed = csvRows(body.csv),
        headers = parsed[0].map((x) => x.trim()),
        mapping = body.mapping as Record<string, unknown>;
      for (const field of required[resource])
        if (
          typeof mapping[field] !== "string" ||
          !headers.includes(String(mapping[field]))
        )
          throw new AuthError(
            400,
            "VALIDATION_ERROR",
            `Map the required ${field} field.`,
          );
      for (const key of Object.keys(mapping))
        if (!fields[resource].includes(key as never))
          throw new AuthError(
            400,
            "VALIDATION_ERROR",
            `Unsupported mapping field: ${key}`,
          );
      const hash = createHash("sha256")
          .update(JSON.stringify({ resource, csv: body.csv, mapping }))
          .digest("hex"),
        existing = db
          .prepare(
            "SELECT id FROM imports WHERE organization_id=? AND content_hash=? AND resource=?",
          )
          .get(user.organization.id, hash, resource) as Row | undefined;
      if (existing) {
        const rows = db
          .prepare(
            "SELECT row_number,status,normalized_json,errors_json FROM import_rows WHERE import_id=? ORDER BY row_number",
          )
          .all(existing.id) as Row[];
        return res.json({
          importId: existing.id,
          replayed: true,
          rows: rows.map((row) => ({
            rowNumber: Number(row.row_number),
            status: row.status,
            normalized: JSON.parse(String(row.normalized_json)),
            ...JSON.parse(String(row.errors_json)),
          })),
        });
      }
      const importId = randomUUID(),
        now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO imports(id,organization_id,creator_membership_id,resource,status,content_hash,mapping_json,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          importId,
          user.organization.id,
          user.membershipId,
          resource,
          "preview",
          hash,
          JSON.stringify(mapping),
          "{}",
          now,
        );
        const insert = db.prepare(
          "INSERT INTO import_rows(id,import_id,row_number,status,normalized_json,errors_json) VALUES(?,?,?,?,?,?)",
        );
        const output = [];
        for (let index = 1; index < parsed.length; index++) {
          const raw: Record<string, string> = {};
          for (const [field, header] of Object.entries(mapping)) {
            const column = headers.indexOf(String(header));
            raw[field] = column >= 0 ? parsed[index][column] : "";
          }
          const checked = validate(resource, raw, db, user.organization.id),
            status = checked.errors.length
              ? "invalid"
              : checked.warnings.length
                ? "warning"
                : "valid";
          insert.run(
            randomUUID(),
            importId,
            index,
            status,
            JSON.stringify(checked.normalized),
            JSON.stringify({
              errors: checked.errors,
              warnings: checked.warnings,
            }),
          );
          output.push({ rowNumber: index, status, ...checked });
        }
        db.prepare("UPDATE imports SET summary_json=? WHERE id=?").run(
          JSON.stringify({
            rows: output.length,
            valid: output.filter((x) => x.status !== "invalid").length,
            invalid: output.filter((x) => x.status === "invalid").length,
          }),
          importId,
        );
        db.exec("COMMIT");
        res.status(201).json({ importId, replayed: false, rows: output });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/commit", async (req, res, next) => {
    try {
      const user = await actor(req, true),
        record = db
          .prepare("SELECT * FROM imports WHERE id=? AND organization_id=?")
          .get(req.params.id, user.organization.id) as Row | undefined;
      if (!record) throw new AuthError(404, "NOT_FOUND", "Import not found.");
      if (record.status === "committed")
        return res.json({
          importId: record.id,
          replayed: true,
          ...JSON.parse(String(record.summary_json)),
        });
      const rows = db
          .prepare(
            "SELECT * FROM import_rows WHERE import_id=? ORDER BY row_number",
          )
          .all(record.id) as Row[],
        accepted = rows.filter((row) => row.status === "valid");
      db.exec("BEGIN IMMEDIATE");
      try {
        const now = new Date().toISOString();
        for (const row of accepted) {
          const value = JSON.parse(String(row.normalized_json));
          const id = randomUUID();
          if (record.resource === "companies")
            db.prepare(
              "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address_json,lifecycle_status,owner_membership_id,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ).run(
              id,
              user.organization.id,
              value.name,
              value.organizationNumber,
              value.externalReference,
              value.website,
              value.phone,
              value.industry,
              value.size,
              JSON.stringify(value.address),
              value.lifecycleStatus,
              user.membershipId,
              JSON.stringify(value.tags),
              value.description,
              now,
              now,
            );
          else
            db.prepare(
              "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,email,phone,job_title,owner_membership_id,status,tags_json,communication_preference,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ).run(
              id,
              user.organization.id,
              value.companyId,
              value.firstName,
              value.lastName,
              value.email,
              value.phone,
              value.jobTitle,
              user.membershipId,
              value.status,
              JSON.stringify(value.tags),
              value.communicationPreference,
              now,
              now,
            );
          db.prepare(
            "UPDATE import_rows SET status='committed',entity_id=? WHERE id=?",
          ).run(id, row.id);
        }
        const summary = {
          rows: rows.length,
          committed: accepted.length,
          invalid: rows.filter((row) => row.status === "invalid").length,
          warnings: rows.filter((row) => row.status === "warning").length,
        };
        db.prepare(
          "UPDATE imports SET status='committed',summary_json=?,committed_at=? WHERE id=?",
        ).run(JSON.stringify(summary), now, record.id);
        db.prepare(
          "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          user.organization.id,
          user.membershipId,
          "import.committed",
          "import",
          record.id,
          randomUUID(),
          JSON.stringify(summary),
          now,
        );
        db.exec("COMMIT");
        res.json({ importId: record.id, replayed: false, ...summary });
      } catch (error) {
        db.exec("ROLLBACK");
        if (String(error).includes("UNIQUE constraint failed"))
          throw new AuthError(
            409,
            "IMPORT_CONFLICT",
            "Data changed after preview. Review duplicates and preview again.",
          );
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });
  router.get("/export/:resource", async (req, res, next) => {
    try {
      const user = await actor(req),
        resource = req.params.resource as Resource;
      if (!fields[resource])
        throw new AuthError(404, "NOT_FOUND", "Export not found.");
      const params: unknown[] = [user.organization.id],
        where = ["organization_id=?", "archived_at IS NULL"];
      if (resource === "companies") {
        if (typeof req.query.lifecycle === "string" && req.query.lifecycle) {
          where.push("lifecycle_status=?");
          params.push(req.query.lifecycle);
        }
        if (typeof req.query.q === "string" && req.query.q) {
          where.push("name LIKE ?");
          params.push(`%${req.query.q}%`);
        }
        const rows = db
          .prepare(
            `SELECT name,organization_number,external_reference,website,phone,industry,size,lifecycle_status,tags_json,description FROM companies WHERE ${where.join(" AND ")} ORDER BY name,id`,
          )
          .all(...params) as Row[];
        const header = [
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
          keys = [
            "name",
            "organization_number",
            "external_reference",
            "website",
            "phone",
            "industry",
            "size",
            "lifecycle_status",
            "tags_json",
            "description",
          ];
        return sendCsv(res, "companies", header, rows, keys);
      }
      if (typeof req.query.status === "string" && req.query.status) {
        where.push("status=?");
        params.push(req.query.status);
      }
      const rows = db
        .prepare(
          `SELECT first_name,last_name,email,phone,job_title,status,tags_json,communication_preference,company_id FROM contacts WHERE ${where.join(" AND ")} ORDER BY last_name,first_name,id`,
        )
        .all(...params) as Row[];
      return sendCsv(
        res,
        "contacts",
        [
          "firstName",
          "lastName",
          "email",
          "phone",
          "jobTitle",
          "status",
          "tags",
          "communicationPreference",
          "companyId",
        ],
        rows,
        [
          "first_name",
          "last_name",
          "email",
          "phone",
          "job_title",
          "status",
          "tags_json",
          "communication_preference",
          "company_id",
        ],
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}
function sendCsv(
  res: Response,
  name: string,
  headers: string[],
  rows: Row[],
  keys: string[],
) {
  const body =
    [
      headers.map(safe).join(","),
      ...rows.map((row) =>
        keys
          .map((key) =>
            safe(
              key === "tags_json"
                ? JSON.parse(String(row[key] ?? "[]")).join(";")
                : row[key],
            ),
          )
          .join(","),
      ),
    ].join("\r\n") + "\r\n";
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${name}.csv"`);
  res.send(body);
}
