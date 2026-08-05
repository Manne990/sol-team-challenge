import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
type Kind = "company" | "contact";
const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
const phone = (value: unknown) => String(value ?? "").replace(/\D/gu, "");
const host = (value: unknown) => {
  try {
    return new URL(String(value)).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    return "";
  }
};
const facts = (kind: Kind, row: Row) =>
  kind === "company"
    ? {
        name: normalize(row.name)
          .replace(/\b(ab|inc|ltd|llc)\.?$/u, "")
          .trim(),
        organizationNumber: normalize(row.organization_number),
        externalReference: normalize(row.external_reference),
        websiteHost: host(row.website),
        phone: phone(row.phone),
      }
    : {
        email: normalize(row.email),
        phone: phone(row.phone),
        nameAndCompany: `${normalize(row.first_name)} ${normalize(row.last_name)}|${normalize(row.company_id)}`,
      };
const fields = {
  company: [
    "name",
    "organization_number",
    "external_reference",
    "website",
    "phone",
    "industry",
    "size",
    "address_json",
    "lifecycle_status",
    "owner_membership_id",
    "tags_json",
    "description",
  ],
  contact: [
    "company_id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "job_title",
    "owner_membership_id",
    "status",
    "tags_json",
    "communication_preference",
  ],
} as const;
const table = (kind: Kind) => (kind === "company" ? "companies" : "contacts");
function same(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
export class MergeStore {
  constructor(private db: SqliteDatabase) {}
  candidates(org: string, kind: Kind) {
    const rows = this.db
        .prepare(
          `SELECT * FROM ${table(kind)} r WHERE organization_id=? AND NOT EXISTS
          (SELECT 1 FROM merge_redirects m WHERE m.organization_id=r.organization_id AND m.entity_type=? AND m.retired_id=r.id) ORDER BY id`,
        )
        .all(org, kind) as Row[],
      out = [];
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = facts(kind, rows[i]),
          b = facts(kind, rows[j]),
          reasons = Object.keys(a)
            .filter((key) => {
              const value = a[key as keyof typeof a];
              return Boolean(value) && value === b[key as keyof typeof b];
            })
            .map((key) => ({
              field: key,
              normalized: a[key as keyof typeof a],
            }));
        if (reasons.length)
          out.push({
            id: `${rows[i].id}:${rows[j].id}`,
            left: this.summary(kind, rows[i]),
            right: this.summary(kind, rows[j]),
            reasons,
          });
      }
    return out.sort(
      (a, b) => b.reasons.length - a.reasons.length || a.id.localeCompare(b.id),
    );
  }
  private summary(kind: Kind, row: Row) {
    return {
      id: String(row.id),
      label:
        kind === "company"
          ? String(row.name)
          : `${row.first_name} ${row.last_name}`,
      version: Number(row.version),
      archived: Boolean(row.archived_at),
      facts: facts(kind, row),
      fields: Object.fromEntries(fields[kind].map((key) => [key, row[key]])),
    };
  }
  merge(actor: AuthenticatedUser, kind: Kind, input: Row) {
    const survivorId = String(input.survivorId ?? ""),
      retiredId = String(input.retiredId ?? "");
    if (
      !survivorId ||
      !retiredId ||
      survivorId === retiredId ||
      !input.fields ||
      typeof input.fields !== "object"
    )
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Choose two different records and resolve their fields.",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const survivor = this.db
          .prepare(
            `SELECT * FROM ${table(kind)} WHERE id=? AND organization_id=?`,
          )
          .get(survivorId, actor.organization.id) as Row | undefined,
        retired = this.db
          .prepare(
            `SELECT * FROM ${table(kind)} WHERE id=? AND organization_id=?`,
          )
          .get(retiredId, actor.organization.id) as Row | undefined;
      if (!survivor || !retired)
        throw new AuthError(404, "NOT_FOUND", "Merge records were not found.");
      if (
        Number(input.survivorVersion) !== Number(survivor.version) ||
        Number(input.retiredVersion) !== Number(retired.version)
      )
        throw new AuthError(
          409,
          "EDIT_CONFLICT",
          "A merge record changed. Review the latest values.",
        );
      if (
        this.db
          .prepare(
            "SELECT 1 FROM merge_redirects WHERE organization_id=? AND entity_type=? AND (retired_id IN (?,?) OR survivor_id=?)",
          )
          .get(actor.organization.id, kind, survivorId, retiredId, retiredId)
      )
        throw new AuthError(
          409,
          "MERGE_CHAIN_CONFLICT",
          "Resolve the current survivor before merging again.",
        );
      const selected = input.fields as Row;
      for (const key of fields[kind])
        if (
          !same(selected[key], survivor[key]) &&
          !same(selected[key], retired[key])
        )
          throw new AuthError(
            400,
            "VALIDATION_ERROR",
            `Resolve ${key} using one of the reviewed values.`,
          );
      const now = new Date().toISOString();
      if (kind === "company")
        this.mergeCompany(actor.organization.id, survivorId, retiredId);
      else this.mergeContact(actor.organization.id, survivorId, retiredId);
      if (kind === "company")
        this.db
          .prepare(
            "UPDATE companies SET organization_number=NULL,external_reference=NULL,archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
          )
          .run(now, now, retiredId, actor.organization.id);
      else
        this.db
          .prepare(
            "UPDATE contacts SET email=NULL,archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
          )
          .run(now, now, retiredId, actor.organization.id);
      const assignments = fields[kind].map((key) => `${key}=?`).join(",");
      this.db
        .prepare(
          `UPDATE ${table(kind)} SET ${assignments},updated_at=?,version=version+1 WHERE id=? AND organization_id=?`,
        )
        .run(
          ...fields[kind].map((key) => selected[key] ?? null),
          now,
          survivorId,
          actor.organization.id,
        );
      this.db
        .prepare(
          "INSERT INTO merge_redirects(organization_id,entity_type,retired_id,survivor_id,merged_by_membership_id,merged_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          actor.organization.id,
          kind,
          retiredId,
          survivorId,
          actor.membershipId,
          now,
        );
      const label =
        kind === "company"
          ? String(retired.name)
          : `${retired.first_name} ${retired.last_name}`;
      this.db
        .prepare(
          "INSERT INTO merge_aliases(id,organization_id,entity_type,survivor_id,retired_id,alias,normalized_alias,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          actor.organization.id,
          kind,
          survivorId,
          retiredId,
          label,
          normalize(label),
          now,
        );
      this.db
        .prepare(
          "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          actor.organization.id,
          actor.membershipId,
          `${kind}.merged`,
          kind,
          survivorId,
          randomUUID(),
          JSON.stringify({ retiredId, alias: label }),
          now,
        );
      this.db.exec("COMMIT");
      return {
        survivorId,
        retiredId,
        redirect: `/api/${kind === "company" ? "companies" : "contacts"}/${survivorId}`,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private mergeCompany(org: string, survivor: string, retired: string) {
    for (const name of ["contacts", "activities", "deals", "tasks"])
      this.db
        .prepare(
          `UPDATE ${name} SET company_id=? WHERE organization_id=? AND company_id=?`,
        )
        .run(survivor, org, retired);
  }
  private mergeContact(org: string, survivor: string, retired: string) {
    for (const name of ["activities", "tasks"])
      this.db
        .prepare(
          `UPDATE ${name} SET contact_id=? WHERE organization_id=? AND contact_id=?`,
        )
        .run(survivor, org, retired);
    for (const [name, parent] of [
      ["deal_contacts", "deal_id"],
      ["activity_participants", "activity_id"],
    ]) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO ${name}(organization_id,${parent},contact_id${name === "deal_contacts" ? ",created_at" : ""}) SELECT organization_id,${parent},?${name === "deal_contacts" ? ",created_at" : ""} FROM ${name} WHERE organization_id=? AND contact_id=?`,
        )
        .run(survivor, org, retired);
      this.db
        .prepare(`DELETE FROM ${name} WHERE organization_id=? AND contact_id=?`)
        .run(org, retired);
    }
  }
}
export function mergesRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router(),
    store = new MergeStore(db),
    actor = async (req: Request, write = false) =>
      auth.requireRole(
        await auth.authenticate(readCookie(req.headers.cookie, SESSION_COOKIE)),
        write ? ["owner", "member"] : ["owner", "member", "viewer"],
      );
  router.get("/:kind", async (req, res, next) => {
    try {
      const user = await actor(req),
        kind =
          req.params.kind === "companies"
            ? "company"
            : req.params.kind === "contacts"
              ? "contact"
              : null;
      if (!kind)
        throw new AuthError(404, "NOT_FOUND", "Duplicate view not found.");
      res.json({ candidates: store.candidates(user.organization.id, kind) });
    } catch (e) {
      next(e);
    }
  });
  router.post("/:kind/merge", async (req, res, next) => {
    try {
      const user = await actor(req, true),
        kind =
          req.params.kind === "companies"
            ? "company"
            : req.params.kind === "contacts"
              ? "contact"
              : null;
      if (!kind) throw new AuthError(404, "NOT_FOUND", "Merge type not found.");
      res.json(store.merge(user, kind, req.body as Row));
    } catch (e) {
      next(e);
    }
  });
  return router;
}
