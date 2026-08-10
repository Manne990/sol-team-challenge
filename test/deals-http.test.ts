import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

let server: Server | undefined,
  database: DatabaseSync | undefined,
  directory: string | undefined;
afterEach(() => {
  server?.close();
  database?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  server = undefined;
  database = undefined;
  directory = undefined;
});

async function setup() {
  directory = mkdtempSync(join(tmpdir(), "northstar-deals-"));
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
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(id, name, id, now, now);
  for (const [id, email] of [
    ["user_owner_a", "a@test.local"],
    ["user_member_a", "m@test.local"],
    ["user_viewer_a", "v@test.local"],
    ["user_owner_b", "b@test.local"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, email, "hash", id, now, now);
  for (const [org, user, role] of [
    ["organization_a", "user_owner_a", "owner"],
    ["organization_a", "user_member_a", "member"],
    ["organization_a", "user_viewer_a", "viewer"],
    ["organization_b", "user_owner_b", "owner"],
  ] as const)
    database
      .prepare("INSERT INTO memberships VALUES(?,?,?,?,NULL)")
      .run(org, user, role, now);
  for (const [token, user, org] of [
    ["owner-token", "user_owner_a", "organization_a"],
    ["member-token", "user_member_a", "organization_a"],
    ["viewer-token", "user_viewer_a", "organization_a"],
    ["outside-token", "user_owner_b", "organization_b"],
  ] as const)
    database
      .prepare(
        "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        `session-${user}`,
        user,
        org,
        createHash("sha256").update(token).digest("hex"),
        "2099-01-01T00:00:00.000Z",
        now,
      );
  for (const [id, org, name] of [
    ["stage_a_1", "organization_a", "Lead"],
    ["stage_a_2", "organization_a", "Proposal"],
    ["stage_b_1", "organization_b", "Lead"],
  ] as const)
    database
      .prepare(
        "INSERT INTO pipeline_stages(id,organization_id,name,position,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, org, name, id.endsWith("1") ? 0 : 1, now, now);
  for (const [id, org, owner] of [
    ["company_a_1", "organization_a", "user_owner_a"],
    ["company_b_1", "organization_b", "user_owner_b"],
  ] as const)
    database
      .prepare(
        "INSERT INTO companies(id,organization_id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, org, id, owner, now, now);
  database
    .prepare(
      "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "contact_a_1",
      "organization_a",
      "company_a_1",
      "A",
      "Buyer",
      "user_owner_a",
      now,
      now,
    );
  server = createApp(database, false).listen(0, "127.0.0.1");
  await new Promise<void>((resolvePromise) =>
    server!.once("listening", resolvePromise),
  );
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
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
const input = {
  name: "Nordic expansion",
  companyId: "company_a_1",
  ownerId: "user_owner_a",
  stageId: "stage_a_1",
  amountMinor: 125000,
  currency: "SEK",
  probability: 40,
  expectedCloseDate: "2026-10-20",
  contactIds: ["contact_a_1"],
};

describe.sequential("deal and pipeline API", () => {
  it("creates, filters, totals, transitions, records history, archives, and restores", async () => {
    const base = await setup();
    const created = await fetch(
      `${base}/api/deals`,
      options("member-token", "POST", input),
    );
    expect(created.status).toBe(201);
    const deal = (await created.json()) as { id: string; version: number };
    const list = (await (
      await fetch(
        `${base}/api/deals?stageId=stage_a_1&currency=SEK`,
        options("owner-token"),
      )
    ).json()) as { total: number; stages: Array<{ deals: unknown[] }> };
    expect(list.total).toBe(1);
    expect(list.stages[0]!.deals).toHaveLength(1);
    const moved = await fetch(
      `${base}/api/deals/${deal.id}/transition`,
      options("member-token", "POST", {
        stageId: "stage_a_2",
        status: "lost",
        lossReason: "Budget",
        version: deal.version,
      }),
    );
    expect(moved.status).toBe(200);
    const transitioned = (await moved.json()) as {
      version: number;
      probability: number;
      status: string;
    };
    expect(transitioned).toMatchObject({ probability: 0, status: "lost" });
    const detail = (await (
      await fetch(`${base}/api/deals/${deal.id}`, options("owner-token"))
    ).json()) as { contacts: unknown[]; stageHistory: unknown[] };
    expect(detail.contacts).toHaveLength(1);
    expect(detail.stageHistory).toHaveLength(2);
    expect(
      (
        await fetch(
          `${base}/api/deals/${deal.id}/transition`,
          options("member-token", "POST", {
            stageId: "stage_a_1",
            status: "open",
            version: deal.version,
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(
          `${base}/api/deals/${deal.id}/archive`,
          options("owner-token", "POST", {}),
        )
      ).status,
    ).toBe(200);
    expect(
      await (await fetch(`${base}/api/deals`, options("owner-token"))).json(),
    ).toMatchObject({ total: 0 });
    expect(
      (
        await fetch(
          `${base}/api/deals/${deal.id}/restore`,
          options("owner-token", "POST", {}),
        )
      ).status,
    ).toBe(200);
  });
  it("enforces outcomes, owner-only stage configuration, roles, and tenant isolation", async () => {
    const base = await setup();
    expect(
      (await fetch(`${base}/api/deals`, options("viewer-token", "POST", input)))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `${base}/api/deals`,
          options("owner-token", "POST", {
            ...input,
            companyId: "company_b_1",
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(
          `${base}/api/deals/stages`,
          options("member-token", "PUT", {
            stages: [{ id: "stage_a_1", name: "Lead" }],
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `${base}/api/deals/stages`,
          options("owner-token", "PUT", {
            stages: [
              { id: "stage_a_2", name: "Proposal", color: "#123456" },
              { id: "stage_a_1", name: "Lead" },
              { name: "Contract" },
            ],
          }),
        )
      ).status,
    ).toBe(200);
    const created = (await (
      await fetch(`${base}/api/deals`, options("owner-token", "POST", input))
    ).json()) as { id: string; version: number };
    expect(
      (
        await fetch(
          `${base}/api/deals/${created.id}/transition`,
          options("owner-token", "POST", {
            stageId: "stage_a_2",
            status: "lost",
            version: created.version,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await fetch(`${base}/api/deals/${created.id}`, options("outside-token")))
        .status,
    ).toBe(404);
    expect(
      await (await fetch(`${base}/api/deals`, options("outside-token"))).json(),
    ).toMatchObject({ total: 0 });
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM deals WHERE organization_id='organization_b'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });
});
