// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import { createApp } from "./app.js";
import { openProductDatabase } from "./database.js";
import { safeAuditSummary } from "./governance.js";
type Database = ReturnType<typeof openProductDatabase>;
let database: Database, server: Server, baseUrl: string;
beforeEach(async () => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
  server = createServer(createApp(database));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  database.close();
});
async function signIn(
  email = "owner@northstar.test",
  password = "OwnerPass!2026",
) {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0];
}
const request = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", cookie, ...init.headers },
  });
describe("organization governance", () => {
  test("updates safe settings with concurrency and appends a correlated audit event", async () => {
    const cookie = await signIn();
    const current = await (
      await request("/api/governance/organization", cookie)
    ).json();
    const update = await request("/api/governance/organization", cookie, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Northstar Nordic",
        currency: "eur",
        timezone: "Europe/Stockholm",
        staleAccountDays: 45,
        version: current.organization.version,
      }),
    });
    expect(update.status).toBe(200);
    expect((await update.json()).organization).toMatchObject({
      name: "Northstar Nordic",
      settings: {
        currency: "EUR",
        timezone: "Europe/Stockholm",
        staleAccountDays: 45,
      },
      version: 2,
    });
    expect(
      (
        await request("/api/governance/organization", cookie, {
          method: "PATCH",
          body: JSON.stringify({
            name: "Stale",
            currency: "SEK",
            timezone: "UTC",
            staleAccountDays: 30,
            version: 1,
          }),
        })
      ).status,
    ).toBe(409);
    const event = database
      .prepare(
        "SELECT correlation_id,summary_json FROM audit_events WHERE action='organization.updated'",
      )
      .get() as { correlation_id: string; summary_json: string };
    expect(event.correlation_id).toBeTruthy();
    expect(JSON.parse(event.summary_json)).not.toHaveProperty("password");
  });
  test("keeps organization settings and audit counts hidden from members and outsiders", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026"),
      outside = await signIn("other-owner@outside.test", "OutsidePass!2026");
    expect((await request("/api/governance/organization", member)).status).toBe(
      403,
    );
    expect((await request("/api/governance/audit", member)).status).toBe(403);
    const outsideAudit = await (
      await request("/api/governance/audit", outside)
    ).json();
    expect(JSON.stringify(outsideAudit)).not.toContain("Northstar Account");
    expect(
      outsideAudit.items.every(
        (item: { actor?: { email: string } }) =>
          item.actor?.email !== "owner@northstar.test",
      ),
    ).toBe(true);
  });
});
describe("membership administration", () => {
  test("protects the last owner, supports another owner, and makes self-revocation immediately stale", async () => {
    const owner = await signIn();
    expect(
      (
        await request("/api/auth/members/mem_owner", owner, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
    const create = await request("/api/auth/members", owner, {
      method: "POST",
      body: JSON.stringify({
        email: "backup-owner@northstar.test",
        firstName: "Backup",
        lastName: "Owner",
        password: "BackupPass!2026",
        role: "owner",
      }),
    });
    expect(create.status).toBe(201);
    const backup = await create.json();
    expect(
      (
        await request("/api/auth/members/mem_owner", owner, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect((await request("/api/auth/session", owner)).status).toBe(401);
    expect(
      await signIn("backup-owner@northstar.test", "BackupPass!2026"),
    ).toBeTruthy();
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM audit_events WHERE action='membership.revoked' AND entity_id='mem_owner'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(backup.member.role).toBe("owner");
  });
});
describe("append-only audit queries", () => {
  test("filters and paginates tenant-first with safe summaries", async () => {
    const cookie = await signIn();
    database
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "unsafe",
        "org_northstar",
        "mem_owner",
        "import.committed",
        "import",
        "imp_test",
        "correlation-test",
        JSON.stringify({
          password: "secret",
          sessionToken: "token",
          completeCsv: "a,b",
          safe: "count 2",
        }),
        "2026-08-09T12:00:00Z",
      );
    const response = await request(
        "/api/governance/audit?action=import.committed&entityType=import&pageSize=1",
        cookie,
      ),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 1, total: 1, pages: 1 });
    expect(body.items[0]).toMatchObject({
      correlationId: "correlation-test",
      summary: {
        password: "[redacted]",
        sessionToken: "[redacted]",
        completeCsv: "[redacted]",
        safe: "count 2",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
  test("redacts nested sensitive keys and bounds large values", () => {
    expect(
      safeAuditSummary({
        nested: { credential: "secret" },
        payload: ["row"],
        safe: "x".repeat(600),
      }),
    ).toEqual({
      nested: { credential: "[redacted]" },
      payload: "[redacted]",
      safe: `${"x".repeat(500)}…`,
    });
  });
});
