// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { MergeStore } from "./merges.js";
import { openProductDatabase } from "./database.js";
type Row = Record<string, unknown>;
const actor: AuthenticatedUser = {
  id: "usr_member",
  membershipId: "mem_member",
  email: "member@northstar.test",
  name: "Member",
  role: "member",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2099-01-01T00:00:00Z",
};
describe("history-preserving merge", () => {
  let db: Database.Database, store: MergeStore;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const migration of [
      "migrations/001_initial.sql",
      "migrations/003_merge_aliases.sql",
    ])
      db.exec(readFileSync(migration, "utf8"));
    seedDatabase(db as never);
    store = new MergeStore(db as unknown as SqliteDatabase);
  });
  const fields = (kind: "company" | "contact", id: string) => {
    const columns =
      kind === "company"
        ? [
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
          ]
        : [
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
          ];
    const row = db
      .prepare(
        `SELECT * FROM ${kind === "company" ? "companies" : "contacts"} WHERE id=?`,
      )
      .get(id) as Row;
    return Object.fromEntries(columns.map((key) => [key, row[key]]));
  };
  it("suggests normalized facts and transactionally moves every company relation", () => {
    db.prepare(
      "UPDATE companies SET name='Northstar Account 1 AB',phone='+46 8 555 0001' WHERE id='cmp_0002_northstar'",
    ).run();
    db.prepare(
      "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES('retired-history','org_northstar','mem_member','company.updated','company','cmp_0001_northstar','history','{}','2026-08-05T12:00:00Z')",
    ).run();
    const candidate = store
      .candidates("org_northstar", "company")
      .find(
        (item) =>
          item.id.includes("cmp_0001_northstar") &&
          item.id.includes("cmp_0002_northstar"),
      );
    expect(candidate?.reasons.map((x) => x.field)).toEqual(
      expect.arrayContaining(["name", "phone"]),
    );
    const result = store.merge(actor, "company", {
      survivorId: "cmp_0002_northstar",
      retiredId: "cmp_0001_northstar",
      survivorVersion: 1,
      retiredVersion: 1,
      fields: fields("company", "cmp_0002_northstar"),
    });
    expect(result.survivorId).toBe("cmp_0002_northstar");
    for (const table of ["contacts", "activities", "deals", "tasks"])
      expect(
        (
          db
            .prepare(
              `SELECT count(*) count FROM ${table} WHERE company_id='cmp_0001_northstar'`,
            )
            .get() as Row
        ).count,
      ).toBe(0);
    expect(
      db
        .prepare(
          "SELECT survivor_id FROM merge_redirects WHERE retired_id='cmp_0001_northstar'",
        )
        .get(),
    ).toEqual({ survivor_id: "cmp_0002_northstar" });
    expect(
      db
        .prepare(
          "SELECT alias FROM merge_aliases WHERE retired_id='cmp_0001_northstar'",
        )
        .get(),
    ).toEqual({ alias: "Northstar Account 1" });
    expect(
      (
        db
          .prepare(
            "SELECT count(*) count FROM audit_events WHERE entity_id='cmp_0001_northstar'",
          )
          .get() as Row
      ).count,
    ).toBeGreaterThan(0);
  });
  it("deduplicates contact edges and preserves chronological activities", () => {
    db.prepare(
      "UPDATE contacts SET email='contact1@example.test' WHERE id='con_0002_northstar'",
    ).run();
    db.prepare(
      "INSERT OR IGNORE INTO deal_contacts(organization_id,deal_id,contact_id,created_at) VALUES('org_northstar','deal_0001_northstar','con_0002_northstar',?)",
    ).run("2026-08-05T12:00:00Z");
    const before = Number(
      (
        db
          .prepare(
            "SELECT count(*) count FROM activities WHERE contact_id IN ('con_0001_northstar','con_0002_northstar')",
          )
          .get() as Row
      ).count,
    );
    store.merge(actor, "contact", {
      survivorId: "con_0002_northstar",
      retiredId: "con_0001_northstar",
      survivorVersion: 1,
      retiredVersion: 1,
      fields: fields("contact", "con_0002_northstar"),
    });
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT count(*) count FROM activities WHERE contact_id='con_0002_northstar'",
            )
            .get() as Row
        ).count,
      ),
    ).toBe(before);
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT count(*) count FROM deal_contacts WHERE deal_id='deal_0001_northstar' AND contact_id='con_0002_northstar'",
            )
            .get() as Row
        ).count,
      ),
    ).toBe(1);
  });
  it("rejects stale, replayed, chained, and foreign merge attempts without foreign changes", () => {
    const selected = fields("company", "cmp_0002_northstar"),
      outside = db
        .prepare("SELECT * FROM companies WHERE id='cmp_outside'")
        .get();
    expect(() =>
      store.merge(actor, "company", {
        survivorId: "cmp_0002_northstar",
        retiredId: "cmp_0001_northstar",
        survivorVersion: 99,
        retiredVersion: 1,
        fields: selected,
      }),
    ).toThrow(/changed/);
    expect(() =>
      store.merge(actor, "company", {
        survivorId: "cmp_0002_northstar",
        retiredId: "cmp_outside",
        survivorVersion: 1,
        retiredVersion: 1,
        fields: selected,
      }),
    ).toThrow(/not found/);
    store.merge(actor, "company", {
      survivorId: "cmp_0002_northstar",
      retiredId: "cmp_0001_northstar",
      survivorVersion: 1,
      retiredVersion: 1,
      fields: selected,
    });
    expect(() =>
      store.merge(actor, "company", {
        survivorId: "cmp_0003_northstar",
        retiredId: "cmp_0001_northstar",
        survivorVersion: 1,
        retiredVersion: 2,
        fields: fields("company", "cmp_0003_northstar"),
      }),
    ).toThrow();
    expect(
      db.prepare("SELECT * FROM companies WHERE id='cmp_outside'").get(),
    ).toEqual(outside);
    expect(() =>
      db
        .prepare(
          "UPDATE companies SET archived_at=NULL WHERE id='cmp_0001_northstar'",
        )
        .run(),
    ).toThrow(/cannot be restored/);
  });
  it("does not suggest unrelated records and identifies archived candidates without mutating either", () => {
    const before = db
      .prepare(
        "SELECT id,name,archived_at FROM companies WHERE id IN ('cmp_0001_northstar','cmp_0002_northstar') ORDER BY id",
      )
      .all();
    expect(
      store
        .candidates("org_northstar", "company")
        .some(
          (item) =>
            item.id.includes("cmp_0001_northstar") &&
            item.id.includes("cmp_0002_northstar"),
        ),
    ).toBe(false);
    expect(
      db
        .prepare(
          "SELECT id,name,archived_at FROM companies WHERE id IN ('cmp_0001_northstar','cmp_0002_northstar') ORDER BY id",
        )
        .all(),
    ).toEqual(before);
    db.prepare(
      "UPDATE contacts SET email='contact1@example.test',archived_at='2026-08-01T00:00:00.000Z' WHERE id='con_0002_northstar'",
    ).run();
    const candidate = store
      .candidates("org_northstar", "contact")
      .find(
        (item) =>
          item.id.includes("con_0001_northstar") &&
          item.id.includes("con_0002_northstar"),
      );
    expect(candidate?.right.archived || candidate?.left.archived).toBe(true);
    expect(
      db.prepare("SELECT count(*) count FROM merge_redirects").get(),
    ).toEqual({ count: 0 });
  });
  it("persists aliases and safe redirects after closing and reopening SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "northstar-merge-"));
    const path = join(directory, "restart.sqlite");
    let durable = openProductDatabase(path);
    try {
      seedDatabase(durable as never);
      const durableStore = new MergeStore(durable as unknown as SqliteDatabase);
      const survivorFields = (() => {
        const row = durable
          .prepare("SELECT * FROM companies WHERE id='cmp_0002_northstar'")
          .get() as Row;
        return Object.fromEntries(
          [
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
          ].map((key) => [key, row[key]]),
        );
      })();
      durableStore.merge(actor, "company", {
        survivorId: "cmp_0002_northstar",
        retiredId: "cmp_0001_northstar",
        survivorVersion: 1,
        retiredVersion: 1,
        fields: survivorFields,
      });
      durable.close();
      durable = openProductDatabase(path);
      expect(
        durable
          .prepare(
            "SELECT survivor_id FROM merge_redirects WHERE retired_id='cmp_0001_northstar'",
          )
          .get(),
      ).toEqual({ survivor_id: "cmp_0002_northstar" });
      expect(
        durable
          .prepare(
            "SELECT alias FROM merge_aliases WHERE retired_id='cmp_0001_northstar'",
          )
          .get(),
      ).toEqual({ alias: "Northstar Account 1" });
    } finally {
      durable.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
