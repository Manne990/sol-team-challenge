import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardRouter } from "../src/dashboard/router.js";

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
  directory = mkdtempSync(join(tmpdir(), "northstar-dashboard-"));
  database = new DatabaseSync(join(directory, "test.sqlite"));
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T09:00:00.000Z";
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
    ["user_owner_b", "b@test.local"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, email, "hash", id, now, now);
  for (const [org, user] of [
    ["organization_a", "user_owner_a"],
    ["organization_b", "user_owner_b"],
  ] as const) {
    database
      .prepare("INSERT INTO memberships VALUES(?,?,'owner',?,NULL)")
      .run(org, user, now);
    const token = org === "organization_a" ? "token-a" : "token-b";
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
  }
  for (const [id, org] of [
    ["stage_a", "organization_a"],
    ["stage_b", "organization_b"],
  ] as const)
    database
      .prepare(
        "INSERT INTO pipeline_stages(id,organization_id,name,position,created_at,updated_at) VALUES(? ,?,'Lead',0,?,?)",
      )
      .run(id, org, now, now);
  for (const [id, org, owner] of [
    ["company_a", "organization_a", "user_owner_a"],
    ["company_b", "organization_b", "user_owner_b"],
  ] as const)
    database
      .prepare(
        "INSERT INTO companies(id,organization_id,name,lifecycle_status,owner_id,created_at,updated_at) VALUES(?,?,?,'customer',?,?,?)",
      )
      .run(id, org, id, owner, now, now);
  database
    .prepare(
      "INSERT INTO deals(id,organization_id,name,company_id,owner_id,amount_minor,currency,expected_close_date,probability,stage_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'open',?,?)",
    )
    .run(
      "deal_a",
      "organization_a",
      "Renewal",
      "company_a",
      "user_owner_a",
      500000,
      "SEK",
      "2026-08-20",
      50,
      "stage_a",
      now,
      now,
    );
  database
    .prepare(
      "INSERT INTO deals(id,organization_id,name,company_id,owner_id,amount_minor,currency,expected_close_date,probability,stage_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'open',?,?)",
    )
    .run(
      "deal_b",
      "organization_b",
      "Foreign",
      "company_b",
      "user_owner_b",
      999999,
      "USD",
      "2026-08-20",
      50,
      "stage_b",
      now,
      now,
    );
  database
    .prepare(
      "INSERT INTO tasks(id,organization_id,title,assignee_id,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?)",
    )
    .run(
      "task_a",
      "organization_a",
      "Late",
      "user_owner_a",
      "2026-08-09T09:00:00.000Z",
      now,
      now,
    );
  database
    .prepare(
      "INSERT INTO activities(id,organization_id,type,subject,occurred_at,creator_id,creator_name_snapshot,company_id,company_name_snapshot,created_at,updated_at) VALUES(? ,?,'call',?,?,?,?,?,?,?,?)",
    )
    .run(
      "activity_a",
      "organization_a",
      "Discovery",
      "2026-08-09T09:00:00.000Z",
      "user_owner_a",
      "Owner A",
      "company_a",
      "company_a",
      now,
      now,
    );
  const app = express();
  app.use(
    "/api/dashboard",
    createDashboardRouter(database, () => new Date(now)),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolvePromise) =>
    server!.once("listening", resolvePromise),
  );
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}
const auth = (token: string) => ({
  headers: { cookie: `northstar_session=${token}` },
});
describe.sequential("dashboard evidence", () => {
  it("reconciles tenant-scoped pipeline, activity, tasks, closing, and stale metrics", async () => {
    const base = await setup();
    const response = await fetch(`${base}/api/dashboard`, auth("token-a"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as DashboardResult;
    expect(body.pipeline.values).toEqual([
      { currency: "SEK", amountMinor: 500000, count: 1 },
    ]);
    expect(body.pipeline.stages[0]).toMatchObject({
      count: 1,
      values: [{ currency: "SEK", amountMinor: 500000 }],
    });
    expect(body.tasks).toMatchObject({ overdue: 1, upcoming: 0 });
    expect(body.closingSoon.items).toHaveLength(1);
    expect(body.recentActivities.items).toHaveLength(1);
    expect(body.staleAccounts.items).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("Foreign");
    expect(JSON.stringify(body)).not.toContain("999999");
  });
  it("renders meaningful zero states without leaking foreign counts", async () => {
    const base = await setup();
    const body = (await (
      await fetch(`${base}/api/dashboard`, auth("token-b"))
    ).json()) as DashboardResult;
    expect(body.pipeline.values).toEqual([
      { currency: "USD", amountMinor: 999999, count: 1 },
    ]);
    expect(body.tasks.overdue).toBe(0);
    expect(body.recentActivities.items).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Renewal");
  });
});

type DashboardResult = {
  pipeline: {
    values: unknown[];
    stages: Array<{ count: number; values: unknown[] }>;
  };
  tasks: { overdue: number; upcoming: number };
  closingSoon: { items: unknown[] };
  recentActivities: { items: unknown[] };
  staleAccounts: { items: unknown[] };
};
