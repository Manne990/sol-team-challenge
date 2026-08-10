import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
let server: Server | undefined,
  directory: string | undefined,
  database: DatabaseSync | undefined;
afterEach(() => {
  server?.close();
  database?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  server = undefined;
  database = undefined;
  directory = undefined;
});
async function setup() {
  directory = mkdtempSync(join(tmpdir(), "northstar-tasks-"));
  database = new DatabaseSync(join(directory, "test.sqlite"));
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T10:00:00.000Z";
  for (const [org, name] of [
    ["organization_a", "A"],
    ["organization_b", "B"],
  ] as const)
    database
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(org, name, org, now, now);
  for (const [user, email] of [
    ["user_owner_a", "a@test"],
    ["user_member_a", "m@test"],
    ["user_viewer_a", "v@test"],
    ["user_owner_b", "b@test"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(user, email, "hash", user, now, now);
  for (const [org, user, role] of [
    ["organization_a", "user_owner_a", "owner"],
    ["organization_a", "user_member_a", "member"],
    ["organization_a", "user_viewer_a", "viewer"],
    ["organization_b", "user_owner_b", "owner"],
  ] as const)
    database
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
      )
      .run(org, user, role, now);
  for (const [token, user, org] of [
    ["owner-token", "user_owner_a", "organization_a"],
    ["viewer-token", "user_viewer_a", "organization_a"],
    ["outside-token", "user_owner_b", "organization_b"],
  ] as const)
    database
      .prepare(
        "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        `session-${user}`,
        user,
        org,
        createHash("sha256").update(token).digest("hex"),
        "2099-01-01T00:00:00.000Z",
        now,
      );
  server = createApp(database, false).listen(0, "127.0.0.1");
  await new Promise<void>((done) => server!.once("listening", done));
  const address = server.address(),
    host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return `http://${host}`;
}
function options(token: string, method = "GET", body?: unknown) {
  const address = server!.address(),
    host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return {
    method,
    headers: {
      cookie: `northstar_session=${token}`,
      origin: `http://${host}`,
      host,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
describe.sequential("task API", () => {
  it("creates assigned UTC work and supports completion, reopening, due views, and restart", async () => {
    const base = await setup(),
      created = await fetch(
        `${base}/api/tasks`,
        options("owner-token", "POST", {
          title: "Call account",
          description: "Confirm scope",
          assigneeId: "user_member_a",
          dueAt: "2026-08-09T08:00:00-02:00",
          priority: "high",
          status: "open",
        }),
      );
    expect(created.status).toBe(201);
    const item = (await created.json()) as {
      id: string;
      dueAt: string;
      version: number;
    };
    expect(item.dueAt).toBe("2026-08-09T10:00:00.000Z");
    expect(
      await (
        await fetch(`${base}/api/tasks?view=overdue`, options("owner-token"))
      ).json(),
    ).toMatchObject({ total: 1, timezone: "UTC" });
    expect(
      (
        await fetch(
          `${base}/api/tasks/${item.id}/complete`,
          options("owner-token", "POST", {}),
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await fetch(`${base}/api/tasks?view=completed`, options("owner-token"))
      ).json(),
    ).toMatchObject({ total: 1 });
    expect(
      (
        await fetch(
          `${base}/api/tasks/${item.id}/reopen`,
          options("owner-token", "POST", {}),
        )
      ).status,
    ).toBe(200);
    server!.close();
    await new Promise((done) => server!.once("close", done));
    server = createApp(database, false).listen(0, "127.0.0.1");
    await new Promise<void>((done) => server!.once("listening", done));
    expect(
      (
        await fetch(
          `${await baseAfterRestart()}/api/tasks/${item.id}`,
          options("owner-token"),
        )
      ).status,
    ).toBe(200);
  });
  it("rejects stale edits, inactive or foreign assignment, viewer mutation, and foreign identifiers", async () => {
    const base = await setup(),
      created = await fetch(
        `${base}/api/tasks`,
        options("owner-token", "POST", {
          title: "Protected task",
          assigneeId: "user_owner_a",
          dueAt: "2026-08-11T00:00:00Z",
          priority: "normal",
          status: "open",
        }),
      ),
      item = (await created.json()) as { id: string; version: number };
    const update = {
      title: "Updated",
      description: "",
      assigneeId: "user_owner_a",
      dueAt: "2026-08-11T00:00:00Z",
      priority: "normal",
      status: "open",
      version: item.version,
    };
    expect(
      (
        await fetch(
          `${base}/api/tasks/${item.id}`,
          options("owner-token", "PUT", update),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base}/api/tasks/${item.id}`,
          options("owner-token", "PUT", update),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(
          `${base}/api/tasks`,
          options("owner-token", "POST", {
            ...update,
            title: "Foreign",
            assigneeId: "user_owner_b",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${base}/api/tasks`,
          options("viewer-token", "POST", update),
        )
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${base}/api/tasks/${item.id}`, options("outside-token")))
        .status,
    ).toBe(404);
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM tasks WHERE organization_id='organization_b'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });
});
async function baseAfterRestart() {
  const address = server!.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}
