import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { NotificationStore } from "./notifications.js";

const now = new Date("2026-08-05T20:00:00.000Z");
const member: AuthenticatedUser = {
  id: "usr_member",
  membershipId: "mem_member",
  email: "member@northstar.test",
  name: "Morgan Member",
  role: "member",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2099-01-01T00:00:00Z",
};
const owner: AuthenticatedUser = {
  ...member,
  id: "usr_owner",
  membershipId: "mem_owner",
  email: "owner@northstar.test",
  name: "Avery Owner",
  role: "owner",
};

describe("replay-safe notifications", () => {
  let db: Database.Database, store: NotificationStore;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    seedDatabase(db as never);
    store = new NotificationStore(db as unknown as SqliteDatabase, () => now);
  });
  afterEach(() => db.close());

  it("generates assignment, approaching, overdue, and deal-change events once across replays", () => {
    const audit =
      db.prepare(`INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    audit.run(
      "audit-assignment",
      "org_northstar",
      "mem_owner",
      "task.created",
      "task",
      "task_0002_northstar",
      "corr-a",
      JSON.stringify({ assigneeMembershipId: "mem_member" }),
      now.toISOString(),
    );
    audit.run(
      "audit-deal-change",
      "org_northstar",
      "mem_member",
      "deal.stage_changed",
      "deal",
      "deal_0001_northstar",
      "corr-d",
      JSON.stringify({ from: "Lead", to: "Qualified" }),
      now.toISOString(),
    );
    store.generate("org_northstar");
    const first = Number(
      (
        db
          .prepare(
            "SELECT count(*) count FROM notifications WHERE organization_id='org_northstar'",
          )
          .get() as { count: number }
      ).count,
    );
    store.generate("org_northstar");
    const second = Number(
      (
        db
          .prepare(
            "SELECT count(*) count FROM notifications WHERE organization_id='org_northstar'",
          )
          .get() as { count: number }
      ).count,
    );
    expect(second).toBe(first);
    expect(store.list(member, {}).items.map((item) => item.type)).toContain(
      "assignment",
    );
    expect(store.list(owner, {}).items.map((item) => item.type)).toContain(
      "deal_change",
    );
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM notifications WHERE type IN ('task_due_soon','task_overdue')",
        )
        .get(),
    ).toMatchObject({ count: expect.any(Number) });
  });

  it("keeps read state personal and prevents foreign observation or mutation", () => {
    store.generate("org_northstar");
    const item = store.list(member, {}).items[0];
    expect(item).toBeTruthy();
    store.markRead(member, item.id);
    expect(
      store
        .list(member, { unread: "true" })
        .items.some((entry) => entry.id === item.id),
    ).toBe(false);
    expect(() => store.markRead(owner, item.id)).toThrow(/not found/i);
    db.prepare(
      `INSERT INTO notifications(id,organization_id,recipient_membership_id,deduplication_key,type,title,body,created_at)
      VALUES('outside-note','org_outside','mem_outside','outside','assignment','Secret','Outside only',?)`,
    ).run(now.toISOString());
    const before = db
      .prepare("SELECT * FROM notifications WHERE id='outside-note'")
      .get();
    expect(
      store.list(member, {}).items.some((entry) => entry.id === "outside-note"),
    ).toBe(false);
    expect(() => store.markRead(member, "outside-note")).toThrow(/not found/i);
    expect(
      db.prepare("SELECT * FROM notifications WHERE id='outside-note'").get(),
    ).toEqual(before);
  });

  it("retains archived notifications but removes unsafe navigation targets", () => {
    db.prepare(
      `INSERT INTO notifications(id,organization_id,recipient_membership_id,deduplication_key,type,title,body,entity_type,entity_id,created_at)
      VALUES('archivable','org_northstar','mem_member','archive-test','assignment','Assigned','Follow up 2','task','task_0002_northstar',?)`,
    ).run(now.toISOString());
    expect(
      store.list(member, {}).items.find((item) => item.id === "archivable")
        ?.href,
    ).toContain("#tasks");
    db.prepare(
      "UPDATE tasks SET archived_at=? WHERE id='task_0002_northstar'",
    ).run(now.toISOString());
    expect(
      store.list(member, {}).items.find((item) => item.id === "archivable")
        ?.href,
    ).toBeNull();
  });
});
