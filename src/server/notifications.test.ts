// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Principal } from "../auth/types.js";
import { NotificationStore } from "./notifications.js";

let database: DatabaseSync;
let store: NotificationStore;
const owner: Principal = {
  sessionId: "session-owner",
  userId: "user_owner_a",
  membershipId: "organization_a:user_owner_a",
  organizationId: "organization_a",
  role: "owner",
  expiresAt: "2099-01-01T00:00:00Z",
};
const member: Principal = {
  ...owner,
  sessionId: "session-member",
  userId: "user_member_a",
  membershipId: "organization_a:user_member_a",
  role: "member",
};

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T12:00:00.000Z";
  for (const [id, name] of [
    ["organization_a", "Northstar"],
    ["organization_b", "Outside"],
  ] as const)
    database
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(id, name, id, now, now);
  for (const [id, email] of [
    ["user_owner_a", "owner@northstar.test"],
    ["user_member_a", "member@northstar.test"],
    ["user_owner_b", "owner@outside.test"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, email, "hash", id, now, now);
  for (const [organization, user, role] of [
    ["organization_a", "user_owner_a", "owner"],
    ["organization_a", "user_member_a", "member"],
    ["organization_b", "user_owner_b", "owner"],
  ] as const)
    database
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES(?,?,?,?)",
      )
      .run(organization, user, role, now);
  const task = database.prepare(
    `INSERT INTO tasks(id,organization_id,title,assignee_id,due_at,status,created_at,updated_at)
     VALUES(?,?,?,?,?,'open',?,?)`,
  );
  task.run(
    "task_overdue_a",
    "organization_a",
    "Call overdue account",
    "user_owner_a",
    "2026-08-10T11:59:59.000Z",
    now,
    now,
  );
  task.run(
    "task_boundary_a",
    "organization_a",
    "Prepare proposal",
    "user_member_a",
    "2026-08-11T12:00:00.000Z",
    now,
    now,
  );
  task.run(
    "task_outside_b",
    "organization_b",
    "Private outside work",
    "user_owner_b",
    "2026-08-10T11:00:00.000Z",
    now,
    now,
  );
  database
    .prepare(
      "INSERT INTO companies(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .run("company_a", "organization_a", "Acme", now, now);
  database
    .prepare(
      "INSERT INTO pipeline_stages(id,organization_id,name,position,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run("stage_a", "organization_a", "Proposal", 1, now, now);
  database
    .prepare(
      `INSERT INTO deals(id,organization_id,name,company_id,owner_id,stage_id,status,created_at,updated_at)
       VALUES(?,?,?,?,?,?,'open',?,?)`,
    )
    .run(
      "deal_a",
      "organization_a",
      "Expansion",
      "company_a",
      "user_owner_a",
      "stage_a",
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO deal_stage_history(id,organization_id,deal_id,to_stage_id,actor_id,occurred_at)
       VALUES(?,?,?,?,?,?)`,
    )
    .run(
      "history_a",
      "organization_a",
      "deal_a",
      "stage_a",
      "user_member_a",
      now,
    );
  store = new NotificationStore(
    database,
    () => new Date("2026-08-10T12:00:00.000Z"),
  );
});

afterEach(() => database.close());

describe.sequential("notification policy", () => {
  test("generation is replay-safe at assignment, overdue, due-window, and deal events", () => {
    expect(store.generate("organization_a").created).toBeGreaterThan(0);
    expect(store.generate("organization_a").created).toBe(0);
    const kinds = database
      .prepare(
        "SELECT kind,deduplication_key FROM notifications WHERE organization_id=?",
      )
      .all("organization_a") as { kind: string; deduplication_key: string }[];
    expect(kinds.some(({ kind }) => kind === "task_overdue")).toBe(true);
    expect(kinds.some(({ kind }) => kind === "task_due_soon")).toBe(true);
    expect(kinds.some(({ kind }) => kind === "deal_stage_changed")).toBe(true);
    expect(kinds.some(({ kind }) => kind === "deal_assignment")).toBe(true);
  });

  test("reassignment creates one new recipient event and preserves earlier history", () => {
    store.generate("organization_a");
    database
      .prepare(
        "UPDATE tasks SET assignee_id=?,updated_at=?,version=version+1 WHERE id=?",
      )
      .run("user_member_a", "2026-08-10T12:05:00.000Z", "task_overdue_a");
    expect(store.generate("organization_a").created).toBeGreaterThan(0);
    expect(
      store
        .list(member, { type: "task_assignment" })
        .items.some(({ entityId }) => entityId === "task_overdue_a"),
    ).toBe(true);
    expect(
      store
        .list(owner, { type: "task_assignment" })
        .items.some(({ entityId }) => entityId === "task_overdue_a"),
    ).toBe(true);
  });

  test("read state is personal and foreign state is neither counted nor mutated", () => {
    store.generate("organization_a");
    const beforeOwner = store.list(owner, { unread: "true" });
    const beforeMember = store.list(member, { unread: "true" });
    const target = beforeOwner.items[0]!;
    expect(store.markRead(owner, target.id).readAt).not.toBeNull();
    expect(store.list(owner, { unread: "true" }).total).toBe(
      beforeOwner.total - 1,
    );
    expect(store.list(member, { unread: "true" }).total).toBe(
      beforeMember.total,
    );
    expect(() => store.markRead(member, target.id)).toThrow(/not found/u);
    expect(JSON.stringify(store.list(owner, {}))).not.toContain("outside");
  });
});
