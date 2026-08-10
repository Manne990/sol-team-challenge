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
  dir = mkdtempSync(join(tmpdir(), "northstar-admin-"));
  db = new DatabaseSync(join(dir, "db.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    db.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T00:00:00Z";
  for (const [org, name] of [
    ["organization_a", "A"],
    ["organization_b", "B"],
  ] as const)
    db.prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(org, name, org, now, now);
  for (const [id, org, role] of [
    ["owner_a", "organization_a", "owner"],
    ["owner_a2", "organization_a", "owner"],
    ["member_a", "organization_a", "member"],
    ["owner_b", "organization_b", "owner"],
  ] as const) {
    db.prepare(
      "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).run(id, `${id}@test.local`, "hash", id, now, now);
    db.prepare(
      "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES(?,?,?,?)",
    ).run(org, id, role, now);
    db.prepare(
      "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    ).run(
      `session-${id}`,
      id,
      org,
      createHash("sha256").update(`token-${id}`).digest("hex"),
      "2099-01-01T00:00:00Z",
      now,
    );
  }
  db.prepare(
    "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    "audit-foreign",
    "organization_b",
    "owner_b",
    "company.updated",
    "company",
    "foreign-company",
    "correlation-foreign",
    '{"safe":true}',
    now,
  );
  server = createApp(db, false).listen(0, "127.0.0.1");
  await new Promise<void>((done) => server!.once("listening", done));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}
function options(user = "owner_a", method = "GET", body?: unknown) {
  const address = server!.address(),
    host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return {
    method,
    headers: {
      cookie: `northstar_session=token-${user}`,
      origin: `http://${host}`,
      host,
      "content-type": "application/json",
      "x-request-id": "test-correlation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
describe.sequential("administration and audit", () => {
  it("creates members, changes roles, revokes sessions, updates safe settings, and records safe events", async () => {
    const base = await setup(),
      created = await fetch(
        `${base}/api/admin/members`,
        options("owner_a", "POST", {
          name: "New Person",
          email: "new@test.local",
          password: "Temporary!2026",
          role: "member",
        }),
      );
    expect(created.status).toBe(201);
    const member = (await created.json()) as { id: string };
    db!
      .prepare(
        "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "new-session",
        member.id,
        "organization_a",
        createHash("sha256").update("new-token").digest("hex"),
        "2099-01-01T00:00:00Z",
        "2026-08-10T00:00:00Z",
      );
    expect(
      (
        await fetch(
          `${base}/api/admin/members/${member.id}`,
          options("owner_a", "PUT", { role: "viewer" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        db!
          .prepare("SELECT revoked_at FROM sessions WHERE id='new-session'")
          .get() as { revoked_at: string | null }
      ).revoked_at,
    ).toBeTruthy();
    const org = (await (
      await fetch(`${base}/api/admin/organization`, options())
    ).json()) as { organization: { version: number } };
    expect(
      (
        await fetch(
          `${base}/api/admin/organization`,
          options("owner_a", "PUT", {
            name: "Renamed",
            timezone: "Europe/Stockholm",
            version: org.organization.version,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base}/api/admin/members/${member.id}`,
          options("owner_a", "DELETE"),
        )
      ).status,
    ).toBe(204);
    const audit = (await (
      await fetch(`${base}/api/admin/audit?pageSize=2`, options())
    ).json()) as {
      items: { summary: unknown; correlationId: string }[];
      total: number;
    };
    expect(audit.total).toBe(4);
    expect(
      audit.items.every((item) => item.correlationId === "test-correlation"),
    ).toBe(true);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("Temporary!2026");
    expect(serialized).not.toContain("new-token");
  });
  it("enforces owner, self/last-owner, stale-session, append-only, and foreign audit boundaries", async () => {
    const base = await setup();
    expect(
      (await fetch(`${base}/api/admin/organization`, options("member_a")))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `${base}/api/admin/members/owner_a`,
          options("owner_a", "DELETE"),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(
          `${base}/api/admin/members/owner_a2`,
          options("owner_a", "DELETE"),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await fetch(
          `${base}/api/admin/members/owner_a`,
          options("owner_a", "PUT", { role: "member" }),
        )
      ).status,
    ).toBe(409);
    expect(() =>
      db!
        .prepare(
          "UPDATE audit_events SET action='tampered' WHERE id='audit-foreign'",
        )
        .run(),
    ).toThrow(/append-only/);
    expect(() =>
      db!.prepare("DELETE FROM audit_events WHERE id='audit-foreign'").run(),
    ).toThrow(/append-only/);
    const audit = (await (
      await fetch(`${base}/api/admin/audit`, options())
    ).json()) as { items: { entityId: string | null }[]; total: number };
    expect(
      audit.items.some((item) => item.entityId === "foreign-company"),
    ).toBe(false);
    expect(audit.total).toBeGreaterThan(0);
  });
});
