// @vitest-environment node
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { DealStore } from "./deals.js";

const actor: AuthenticatedUser = {
  id: "usr_member",
  membershipId: "mem_member",
  email: "member@northstar.test",
  name: "Morgan Member",
  role: "member",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2099-01-01T00:00:00Z",
};
const outside: AuthenticatedUser = {
  ...actor,
  id: "usr_outside",
  membershipId: "mem_outside",
  role: "owner",
  organization: { id: "org_outside", name: "Outside Demo" },
};
const input = {
  name: "Expansion 2027",
  companyId: "cmp_0001_northstar",
  contactIds: ["con_0001_northstar"],
  ownerMembershipId: "mem_member",
  stageId: "stage_qualified",
  amountMinor: 125050,
  currency: "sek",
  expectedCloseDate: "2027-01-15",
  probability: 65,
};

describe("deal and pipeline store", () => {
  let db: Database.Database, store: DealStore;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    db.exec(
      readFileSync("migrations/002_pipeline_stage_lifecycle.sql", "utf8"),
    );
    seedDatabase(db as never);
    store = new DealStore(db as unknown as SqliteDatabase);
  });
  afterEach(() => db.close());
  it("creates deals with contacts, initial history, normalized money, and tenant totals", () => {
    const deal = store.write(actor, undefined, input);
    expect(deal.name).toBe(input.name);
    expect(deal.currency).toBe("SEK");
    expect(deal.contacts).toHaveLength(1);
    expect(deal.history[0].fromStage).toBeNull();
    const list = store.list("org_northstar", {
      stageId: "stage_qualified",
      status: "open",
    });
    expect(list.deals.some((x) => x.id === deal.id)).toBe(true);
    expect(
      list.totals.find((x) => x.currency === "SEK")?.amountMinor,
    ).toBeGreaterThanOrEqual(input.amountMinor);
    expect(store.list("org_outside", {}).deals).toHaveLength(0);
  });
  it("moves transactionally, requires loss reason, retains history, and explicitly reopens", () => {
    const created = store.write(actor, undefined, input);
    expect(() =>
      store.transition(actor, created.id, "stage_lost", created.version, ""),
    ).toThrow(/loss reason/);
    expect(store.detail("org_northstar", created.id)?.history).toHaveLength(1);
    const lost = store.transition(
      actor,
      created.id,
      "stage_lost",
      created.version,
      "Budget cancelled",
    );
    expect(lost.status).toBe("lost");
    expect(lost.lossReason).toBe("Budget cancelled");
    expect(lost.history).toHaveLength(2);
    const reopened = store.transition(
      actor,
      created.id,
      "stage_qualified",
      lost.version,
      null,
    );
    expect(reopened.status).toBe("open");
    expect(reopened.lossReason).toBeNull();
    expect(reopened.history).toHaveLength(3);
  });
  it("prevents stale transitions and cross-organization relations without side effects", () => {
    const created = store.write(actor, undefined, input);
    expect(() =>
      store.transition(actor, created.id, "stage_won", 999, null),
    ).toThrow(/changed/);
    expect(() =>
      store.write(outside, undefined, {
        ...input,
        ownerMembershipId: "mem_outside",
        stageId: "stage_outside",
      }),
    ).toThrow(/company/);
    expect(store.detail("org_northstar", created.id)?.status).toBe("open");
    expect(store.detail("org_northstar", created.id)?.history).toHaveLength(1);
  });
  it("lets owners configure lifecycle without invalidating historical stage references", () => {
    const owner = {
      ...actor,
      membershipId: "mem_owner",
      role: "owner" as const,
    };
    const stage = store.createStage(owner, {
      name: "Negotiation",
      color: "#336699",
      outcome: "open",
    });
    expect(stage.active).toBe(true);
    const reordered = store.updateStage(owner, stage.id, {
      version: stage.version,
      position: 1,
    });
    expect(reordered.position).toBe(1);
    const updated = store.updateStage(owner, stage.id, {
      version: reordered.version,
      name: "Negotiation",
      color: stage.color,
      active: false,
    });
    expect(updated.active).toBe(false);
    expect(store.stages("org_northstar").some((x) => x.id === stage.id)).toBe(
      false,
    );
    expect(
      store.stages("org_northstar", true).some((x) => x.id === stage.id),
    ).toBe(true);
  });
  it("rejects edits that silently move stages and archives without erasing history", () => {
    const created = store.write(actor, undefined, input);
    expect(() =>
      store.write(
        actor,
        created.id,
        { ...input, stageId: "stage_proposal" },
        created.version,
      ),
    ).toThrow(/transition action/);
    const archived = store.archive(actor, created.id);
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.history).toHaveLength(1);
    expect(
      store.list("org_northstar", {}).deals.some((x) => x.id === created.id),
    ).toBe(false);
    expect(store.archive(actor, created.id, true).archivedAt).toBeNull();
  });
});
