// @vitest-environment node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import { createApp } from "./app.js";
import { hashSessionSecret } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { TaskStore } from "./tasks.js";

const now = new Date("2026-08-05T20:00:00.000Z");
const actor: AuthenticatedUser = {
  id: "usr_member",
  membershipId: "mem_member",
  email: "member@northstar.test",
  name: "Morgan Member",
  role: "member",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2099-01-01T00:00:00Z",
};
const payload = {
  title: "Prepare renewal briefing",
  description: "Include open risks",
  assigneeMembershipId: "mem_member",
  dueAt: "2026-08-05T22:00:00.000Z",
  priority: "high" as const,
  companyId: "cmp_0001_northstar",
  contactId: null,
  dealId: null,
};

describe("task persistence", () => {
  let db: Database.Database, store: TaskStore;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    seedDatabase(db as never);
    store = new TaskStore(db as unknown as SqliteDatabase, () => now);
  });
  afterEach(() => db.close());

  it("derives overdue, due-today, upcoming, completed, and assigned-to-me views in UTC", () => {
    expect(
      store
        .list(actor, { view: "overdue" })
        .items.every(
          (task) => task.status === "open" && task.dueAt! < now.toISOString(),
        ),
    ).toBe(true);
    expect(
      store
        .list(actor, { view: "today" })
        .items.every((task) => task.dueAt?.startsWith("2026-08-05")),
    ).toBe(true);
    expect(
      store
        .list(actor, { view: "upcoming" })
        .items.every((task) => task.dueAt! >= "2026-08-06T00:00:00.000Z"),
    ).toBe(true);
    expect(
      store
        .list(actor, { view: "completed" })
        .items.every((task) => task.status === "completed"),
    ).toBe(true);
    expect(
      store
        .list(actor, { assignedToMe: "true", view: "open" })
        .items.every((task) => task.assignee.id === "mem_member"),
    ).toBe(true);
  });

  it("creates, edits, completes, reopens, archives, restores, and retains relations", () => {
    const created = store.write(actor, undefined, payload);
    expect(created.company?.id).toBe("cmp_0001_northstar");
    const edited = store.write(
      actor,
      created.id,
      { ...payload, title: "Updated briefing" },
      created.version,
    );
    const completed = store.transition(
      actor,
      created.id,
      "complete",
      edited.version,
    );
    expect(completed.completedAt).toBe(now.toISOString());
    const reopened = store.transition(
      actor,
      created.id,
      "reopen",
      completed.version,
    );
    expect(reopened.completedAt).toBeNull();
    const archived = store.transition(
      actor,
      created.id,
      "archive",
      reopened.version,
    );
    expect(archived.archivedAt).toBeTruthy();
    expect(
      store.transition(actor, created.id, "restore", archived.version)
        .archivedAt,
    ).toBeNull();
  });

  it("rejects stale versions and foreign assignments and relations without changing foreign state", () => {
    const outsideBefore = db
      .prepare("SELECT * FROM tasks WHERE organization_id='org_outside'")
      .all();
    expect(() =>
      store.write(actor, undefined, {
        ...payload,
        assigneeMembershipId: "mem_outside",
      }),
    ).toThrow(/active assignee/);
    expect(() =>
      store.write(actor, undefined, { ...payload, companyId: "cmp_outside" }),
    ).toThrow(/unavailable/);
    const created = store.write(actor, undefined, payload);
    expect(() => store.write(actor, created.id, payload, 999)).toThrow(
      /changed/,
    );
    expect(
      db
        .prepare("SELECT * FROM tasks WHERE organization_id='org_outside'")
        .all(),
    ).toEqual(outsideBefore);
  });
});

describe("task API authorization", () => {
  let db: Database.Database,
    server: ReturnType<typeof createServer>,
    base: string;
  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    seedDatabase(db as never);
    const insert = db.prepare(
      "INSERT INTO sessions(id,token_hash,organization_id,membership_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)",
    );
    for (const [id, secret, org, member] of [
      ["sv", "viewer-secret", "org_northstar", "mem_viewer"],
      ["sm", "member-secret", "org_northstar", "mem_member"],
      ["so", "outside-secret", "org_outside", "mem_outside"],
    ])
      insert.run(
        id,
        hashSessionSecret(secret),
        org,
        member,
        now.toISOString(),
        "2099-01-01T00:00:00Z",
        now.toISOString(),
      );
    server = createServer(createApp(db as unknown as SqliteDatabase));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not start");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
  const request = (path: string, secret: string, init: RequestInit = {}) =>
    fetch(`${base}/api/tasks${path}`, {
      ...init,
      headers: {
        cookie: `northstar_session=${secret}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  it("allows viewers to read but not mutate", async () => {
    expect((await request("?view=overdue", "viewer-secret")).status).toBe(200);
    expect(
      (
        await request("", "viewer-secret", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(403);
  });
  it("does not disclose foreign task records or counts", async () => {
    expect((await (await request("", "outside-secret")).json()).total).toBe(0);
    expect(
      (await request("/task_0001_northstar", "outside-secret")).status,
    ).toBe(404);
  });
  it("lets members create tasks but rejects foreign relationships", async () => {
    expect(
      (
        await request("", "member-secret", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(201);
    const foreign = await request("", "member-secret", {
      method: "POST",
      body: JSON.stringify({ ...payload, companyId: "cmp_outside" }),
    });
    expect(foreign.status).toBe(403);
  });
});
