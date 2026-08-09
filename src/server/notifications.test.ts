// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import { openProductDatabase } from "./database.js";
import { NotificationStore } from "./notifications.js";

type Database = ReturnType<typeof openProductDatabase>;
let database: Database;
let store: NotificationStore;
const owner: AuthenticatedUser = {
  id: "usr_owner",
  membershipId: "mem_owner",
  email: "owner@northstar.test",
  name: "Avery Owner",
  role: "owner",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2026-08-10T00:00:00Z",
};
const member: AuthenticatedUser = {
  ...owner,
  id: "usr_member",
  membershipId: "mem_member",
  email: "member@northstar.test",
  name: "Morgan Member",
  role: "member",
};
beforeEach(() => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
  store = new NotificationStore(
    database,
    () => new Date("2026-08-05T12:00:00.000Z"),
  );
});
afterEach(() => database.close());

describe("notification generation", () => {
  test("is replay-safe with explicit assignment and UTC due-window keys", () => {
    const first = store.generate("org_northstar");
    expect(first.created).toBeGreaterThan(0);
    expect(store.generate("org_northstar").created).toBe(0);
    const rows = database
      .prepare(
        "SELECT type,deduplication_key FROM notifications WHERE organization_id='org_northstar'",
      )
      .all() as Array<{ type: string; deduplication_key: string }>;
    expect(
      rows.some(
        (row) =>
          row.type === "task_overdue" &&
          row.deduplication_key.includes(":overdue:"),
      ),
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.type === "task_due_soon" &&
          row.deduplication_key.includes(":due-soon:"),
      ),
    ).toBe(true);
    expect(rows.some((row) => row.type === "task_assignment")).toBe(true);
    const exactBoundary = database
      .prepare(
        "SELECT type FROM notifications WHERE recipient_membership_id='mem_member' AND deduplication_key LIKE 'task:task_0012_northstar:%'",
      )
      .all() as Array<{ type: string }>;
    expect(exactBoundary.some((row) => row.type === "task_due_soon")).toBe(
      true,
    );
    expect(exactBoundary.some((row) => row.type === "task_overdue")).toBe(
      false,
    );
  });
  test("creates a new recipient notification on reassignment without exposing the old inbox", () => {
    store.generate("org_northstar");
    database
      .prepare(
        "UPDATE tasks SET assignee_membership_id='mem_member',version=version+1 WHERE id='task_0001_northstar'",
      )
      .run();
    expect(store.generate("org_northstar").created).toBeGreaterThanOrEqual(1);
    const memberResult = store.list(member, { type: "task_assignment" });
    expect(
      memberResult.items.some(
        (item) => item.entityId === "task_0001_northstar",
      ),
    ).toBe(true);
    const ownerResult = store.list(owner, { type: "task_assignment" });
    expect(
      ownerResult.items.every((item) => !item.id.startsWith("outside")),
    ).toBe(true);
  });
  test("records every stage-history event for the current organization and owner", () => {
    database
      .prepare(
        "INSERT INTO deal_stage_history(id,organization_id,deal_id,from_stage_id,to_stage_id,actor_membership_id,moved_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "history_test",
        "org_northstar",
        "deal_0001_northstar",
        "stage_lead",
        "stage_qualified",
        "mem_member",
        "2026-08-05T12:15:00.000Z",
      );
    store.generate("org_northstar");
    const item = store
      .list(owner, { type: "deal_stage_changed" })
      .items.find((candidate) => candidate.entityId === "deal_0001_northstar");
    expect(item).toMatchObject({
      title: "Deal stage changed",
      href: "/deals/deal_0001_northstar",
    });
    expect(item?.body).toContain("Qualified");
  });
  test("retains existing notifications when a relation is archived", () => {
    store.generate("org_northstar");
    const before = store.list(owner, {}).total;
    database
      .prepare(
        "UPDATE tasks SET archived_at='2026-08-05T13:00:00.000Z' WHERE id='task_0001_northstar'",
      )
      .run();
    store.generate("org_northstar");
    expect(store.list(owner, {}).total).toBe(before);
    expect(
      store
        .list(owner, { pageSize: 100 })
        .items.some((item) => item.entityId === "task_0001_northstar"),
    ).toBe(true);
  });
});

describe("personal read state", () => {
  test("filters and updates only the signed-in recipient", () => {
    store.generate("org_northstar");
    const ownerBefore = store.list(owner, { unread: "true" });
    const memberBefore = store.list(member, { unread: "true" });
    expect(ownerBefore.total).toBeGreaterThan(0);
    const target = ownerBefore.items[0];
    expect(store.markRead(owner, target.id).readAt).not.toBeNull();
    expect(store.list(owner, { unread: "true" }).total).toBe(
      ownerBefore.total - 1,
    );
    expect(store.list(member, { unread: "true" }).total).toBe(
      memberBefore.total,
    );
    expect(() => store.markRead(member, target.id)).toThrow(/not found/u);
    const all = store.markAllRead(owner);
    expect(all.updated).toBe(ownerBefore.total - 1);
    expect(store.list(owner, { unread: "true" }).total).toBe(0);
  });
  test("never generates or counts another organization", () => {
    store.generate("org_northstar");
    expect(JSON.stringify(store.list(owner, {}))).not.toContain("Outside");
    expect(
      Number(
        (
          database
            .prepare(
              "SELECT count(*) count FROM notifications WHERE organization_id='org_outside'",
            )
            .get() as { count: number }
        ).count,
      ),
    ).toBe(0);
  });
});
