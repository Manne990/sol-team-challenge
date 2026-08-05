import { readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { GovernanceStore } from "./governance.js";

const owner: AuthenticatedUser = {
  id: "usr_owner",
  membershipId: "mem_owner",
  email: "owner@northstar.test",
  name: "Avery Owner",
  role: "owner",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2099-01-01T00:00:00Z",
};
describe("governance and append-only audit", () => {
  let db: Database.Database, store: GovernanceStore;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of readdirSync("migrations")
      .filter((x) => x.endsWith(".sql"))
      .sort())
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
    seedDatabase(db as never);
    store = new GovernanceStore(db as unknown as SqliteDatabase);
  });
  afterEach(() => db.close());
  it("updates only safe organization settings with optimistic concurrency and audit evidence", () => {
    const before = store.organization("org_northstar")!;
    const updated = store.updateOrganization(owner, {
      version: before.version,
      name: "Northstar Sales",
      settings: {
        timezone: "Europe/Stockholm",
        locale: "sv-SE",
        currency: "sek",
        password: "must-not-persist",
      },
    });
    expect(updated.name).toBe("Northstar Sales");
    expect(updated.settings).toEqual({
      timezone: "Europe/Stockholm",
      locale: "sv-SE",
      currency: "SEK",
    });
    expect(() =>
      store.updateOrganization(owner, {
        version: before.version,
        name: "Stale",
        settings: { timezone: "UTC", locale: "en", currency: "USD" },
      }),
    ).toThrow(/changed/);
    const event = store.auditList("org_northstar", {
      action: "organization.updated",
    }).events[0];
    expect(event.correlationId).toBeTruthy();
    expect(JSON.stringify(event.summary)).not.toMatch(
      /password|must-not-persist/,
    );
  });
  it("filters and paginates inside the organization without foreign counts", () => {
    db.prepare(
      "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "foreign-audit",
      "org_outside",
      "mem_outside",
      "company.updated",
      "company",
      "cmp_outside",
      "foreign",
      JSON.stringify({ secret: "foreign", safe: "hidden" }),
      "2026-08-05T12:00:00Z",
    );
    const result = store.auditList("org_northstar", {
      entityType: "company",
      pageSize: "2",
    });
    expect(
      result.events.every(
        (x) =>
          x.organizationId === "org_northstar" && x.entityType === "company",
      ),
    ).toBe(true);
    expect(result.events.some((x) => x.id === "foreign-audit")).toBe(false);
    expect(result.pagination.total).toBeLessThan(100);
  });
  it("defensively removes secret, token, session, and complete-row fields", () => {
    db.prepare(
      "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "unsafe",
      "org_northstar",
      "mem_owner",
      "test.unsafe",
      "test",
      "x",
      "corr",
      JSON.stringify({
        safe: "visible",
        password: "bad",
        sessionToken: "bad",
        completeRow: { email: "private" },
      }),
      "2026-08-05T12:00:00Z",
    );
    expect(
      store.auditList("org_northstar", { action: "test.unsafe" }).events[0]
        .summary,
    ).toEqual({ safe: "visible" });
    expect(() =>
      db
        .prepare("UPDATE audit_events SET action='changed' WHERE id='unsafe'")
        .run(),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare("DELETE FROM audit_events WHERE id='unsafe'").run(),
    ).toThrow(/immutable/);
  });
});
