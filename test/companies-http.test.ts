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
function setup() {
  directory = mkdtempSync(join(tmpdir(), "northstar-companies-"));
  database = new DatabaseSync(join(directory, "test.sqlite"));
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T10:00:00.000Z";
  for (const [id, name] of [
    ["organization_a", "A"],
    ["organization_b", "B"],
  ] as const)
    database
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(id, name, id, now, now);
  for (const [id, email] of [
    ["user_owner_a", "a@test.local"],
    ["user_viewer_a", "v@test.local"],
    ["user_owner_b", "b@test.local"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, email, "hash", id, now, now);
  for (const [org, user, role] of [
    ["organization_a", "user_owner_a", "owner"],
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
  return new Promise<string>((resolvePromise) =>
    server!.once("listening", () => {
      const address = server!.address();
      resolvePromise(
        `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
      );
    }),
  );
}
function options(token: string, method = "GET", body?: unknown) {
  const address = server?.address();
  const host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
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
describe.sequential("company API", () => {
  it("creates, filters, updates, archives, restores, and retains audit history", async () => {
    const base = await setup();
    const created = await fetch(
      `${base}/api/companies`,
      options("owner-token", "POST", {
        name: "Acme Nordic",
        organizationNumber: "SE-100",
        industry: "Manufacturing",
        lifecycleStatus: "customer",
        tags: ["priority"],
      }),
    );
    expect(created.status).toBe(201);
    const company = (await created.json()) as { id: string; version: number };
    const list = await fetch(
      `${base}/api/companies?q=Acme&lifecycle=customer&tag=priority`,
      options("owner-token"),
    );
    expect(await list.json()).toMatchObject({
      total: 1,
      items: [{ name: "Acme Nordic" }],
    });
    const updated = await fetch(
      `${base}/api/companies/${company.id}`,
      options("owner-token", "PUT", {
        name: "Acme Nordic AB",
        organizationNumber: "SE-100",
        lifecycleStatus: "customer",
        version: company.version,
      }),
    );
    expect(updated.status).toBe(200);
    const stale = await fetch(
      `${base}/api/companies/${company.id}`,
      options("owner-token", "PUT", {
        name: "Lost edit",
        lifecycleStatus: "lead",
        version: company.version,
      }),
    );
    expect(stale.status).toBe(409);
    expect(
      await fetch(
        `${base}/api/companies/${company.id}/archive`,
        options("owner-token", "POST", {}),
      ),
    ).toHaveProperty("status", 200);
    expect(
      await (
        await fetch(`${base}/api/companies`, options("owner-token"))
      ).json(),
    ).toMatchObject({ total: 0 });
    expect(
      await fetch(
        `${base}/api/companies/${company.id}/restore`,
        options("owner-token", "POST", {}),
      ),
    ).toHaveProperty("status", 200);
    const detail = (await (
      await fetch(`${base}/api/companies/${company.id}`, options("owner-token"))
    ).json()) as { history: unknown[] };
    expect(detail.history.length).toBe(4);
  });
  it("rejects duplicate identifiers, viewer mutation, anonymous access, and foreign ids without disclosure", async () => {
    const base = await setup();
    const first = await fetch(
      `${base}/api/companies`,
      options("owner-token", "POST", {
        name: "Shared name",
        organizationNumber: "SAME",
        lifecycleStatus: "lead",
      }),
    );
    const id = ((await first.json()) as { id: string }).id;
    expect(
      (
        await fetch(
          `${base}/api/companies`,
          options("owner-token", "POST", {
            name: "Duplicate",
            organizationNumber: "SAME",
            lifecycleStatus: "lead",
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(
          `${base}/api/companies`,
          options("viewer-token", "POST", {
            name: "Forbidden",
            lifecycleStatus: "lead",
          }),
        )
      ).status,
    ).toBe(403);
    expect((await fetch(`${base}/api/companies`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/companies/${id}`, options("outside-token")))
        .status,
    ).toBe(404);
    expect(
      await (
        await fetch(`${base}/api/companies`, options("outside-token"))
      ).json(),
    ).toMatchObject({ total: 0 });
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM companies WHERE organization_id='organization_b'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });
});
