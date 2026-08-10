import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
let server: Server | undefined,
  db: DatabaseSync | undefined,
  dir: string | undefined;
afterEach(() => {
  server?.close();
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  dir = mkdtempSync(join(tmpdir(), "northstar-search-"));
  db = new DatabaseSync(join(dir, "db.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    db.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T00:00:00.000Z";
  for (const [org, name] of [
    ["organization_a", "A"],
    ["organization_b", "B"],
  ] as const)
    db.prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(org, name, org, now, now);
  for (const [user, org] of [
    ["user_owner_a", "organization_a"],
    ["user_owner_b", "organization_b"],
  ] as const) {
    db.prepare(
      "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).run(user, `${user}@test`, "hash", user, now, now);
    db.prepare(
      "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES(?,?,?,?)",
    ).run(org, user, "owner", now);
    const token = `token-${user}`;
    db.prepare(
      "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    ).run(
      `session-${user}`,
      user,
      org,
      createHash("sha256").update(token).digest("hex"),
      "2099-01-01T00:00:00Z",
      now,
    );
    db.prepare(
      "INSERT INTO companies(id,organization_id,name,industry,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(`company-${org}`, org, "Shared Acme", "Technology", user, now, now);
    db.prepare(
      "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,email,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      `contact-${org}`,
      org,
      `company-${org}`,
      "Alex",
      "Acme",
      `${org}@acme.test`,
      user,
      now,
      now,
    );
    db.prepare(
      "INSERT INTO pipeline_stages(id,organization_id,name,position,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).run(`stage-${org}`, org, "Lead", 0, now, now);
    db.prepare(
      "INSERT INTO deals(id,organization_id,name,company_id,owner_id,stage_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      `deal-${org}`,
      org,
      "Acme renewal",
      `company-${org}`,
      user,
      `stage-${org}`,
      now,
      now,
    );
    db.prepare(
      "INSERT INTO tasks(id,organization_id,title,assignee_id,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      `task-${org}`,
      org,
      "Call Acme",
      user,
      "2026-08-12T00:00:00Z",
      now,
      now,
    );
  }
  server = createApp(db, false).listen(0, "127.0.0.1");
  await new Promise<void>((done) => server!.once("listening", done));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}
function options(user = "user_owner_a", method = "GET", body?: unknown) {
  const address = server!.address(),
    host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return {
    method,
    headers: {
      cookie: `northstar_session=token-${user}`,
      origin: `http://${host}`,
      host,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
describe.sequential("search and saved views", () => {
  it("groups stable scoped results without foreign identifiers", async () => {
    const base = await setup(),
      body = (await (
        await fetch(`${base}/api/search?q=Acme`, options())
      ).json()) as { total: number; groups: Record<string, { id: string }[]> };
    expect(body.total).toBe(4);
    expect(
      Object.values(body.groups)
        .flat()
        .every((item) => !item.id.includes("organization_b")),
    ).toBe(true);
    expect(
      (await (await fetch(`${base}/api/search?q=no-match`, options())).json())
        .total,
    ).toBe(0);
  });
  it("creates, updates, isolates, validates, and deletes personal views", async () => {
    const base = await setup(),
      created = await fetch(
        `${base}/api/search/views`,
        options("user_owner_a", "POST", {
          name: "My accounts",
          resource: "companies",
          definition: { q: "Acme", sort: "name" },
        }),
      );
    expect(created.status).toBe(201);
    const view = (await created.json()) as { id: string; version: number };
    expect(
      (
        await (
          await fetch(`${base}/api/search/views`, options("user_owner_a"))
        ).json()
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await (
          await fetch(`${base}/api/search/views`, options("user_owner_b"))
        ).json()
      ).items,
    ).toHaveLength(0);
    expect(
      (
        await fetch(
          `${base}/api/search/views`,
          options("user_owner_a", "POST", {
            name: "Broken",
            resource: "companies",
            definition: { unsafe: "x" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${base}/api/search/views/${view.id}`,
          options("user_owner_a", "PUT", {
            name: "Renamed",
            resource: "companies",
            definition: { lifecycle: "customer" },
            version: view.version,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base}/api/search/views/${view.id}`,
          options("user_owner_b", "DELETE"),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await (
          await fetch(`${base}/api/search/views`, options("user_owner_a"))
        ).json()
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await fetch(
          `${base}/api/search/views/${view.id}`,
          options("user_owner_a", "DELETE"),
        )
      ).status,
    ).toBe(204);
  });
});
