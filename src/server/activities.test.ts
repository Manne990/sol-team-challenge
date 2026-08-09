// @vitest-environment node
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import { createApp } from "./app.js";
import { openProductDatabase } from "./database.js";
import { ActivityStore } from "./activities.js";

type Database = ReturnType<typeof openProductDatabase>;
let database: Database;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
  database
    .prepare(
      `INSERT INTO activities(id,organization_id,type,subject,body,occurred_at,creator_membership_id,creator_label,related_label_json,created_at,updated_at)
     VALUES('act_outside','org_outside','note','Private history','secret','2026-08-01T10:00:00.000Z','mem_outside','Otto Outside','{}','2026-08-01T10:00:00.000Z','2026-08-01T10:00:00.000Z')`,
    )
    .run();
  server = createServer(createApp(database));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test server failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  database.close();
});

async function signIn(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("session cookie missing");
  return cookie;
}
const request = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init.headers },
  });

describe("activity API", () => {
  it("records a durable timeline entry and linked follow-up atomically", async () => {
    const cookie = await signIn("member@northstar.test", "MemberPass!2026");
    const response = await request("/api/activities", cookie, {
      method: "POST",
      body: JSON.stringify({
        type: "meeting",
        subject: " Renewal planning ",
        body: "Agreed next steps",
        occurredAt: "2026-08-05T14:30:00+02:00",
        companyId: "cmp_0001_northstar",
        contactId: "con_0001_northstar",
        dealId: "deal_0001_northstar",
        participantIds: ["con_0002_northstar", "con_0001_northstar"],
        followUp: {
          title: "Send renewal proposal",
          description: "Include agreed pricing",
          assigneeMembershipId: "mem_member",
          dueAt: "2026-08-07T09:00:00Z",
          priority: "high",
        },
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.activity).toMatchObject({
      type: "meeting",
      subject: "Renewal planning",
      occurredAt: "2026-08-05T12:30:00.000Z",
      creator: { id: "mem_member", name: "Morgan Member" },
      relatedLabels: {
        company: "Northstar Account 1",
        contact: "Contact1 Person1",
        deal: "Opportunity 1",
      },
    });
    expect(
      body.activity.participants.map((item: { id: string }) => item.id),
    ).toEqual(["con_0001_northstar", "con_0002_northstar"]);
    expect(body.activity.followUpTaskId).toBeTruthy();
    expect(
      database
        .prepare("SELECT title FROM tasks WHERE id=?")
        .get(body.activity.followUpTaskId),
    ).toMatchObject({ title: "Send renewal proposal" });
  });

  it("filters and paginates one chronological record set for related details", async () => {
    const cookie = await signIn("viewer@northstar.test", "ViewerPass!2026");
    const response = await request(
      "/api/activities?companyId=cmp_0001_northstar&type=email&from=2026-01-01T00:00:00Z&pageSize=5",
      cookie,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.activities.every(
        (item: { type: string; companyId: string }) =>
          item.type === "email" && item.companyId === "cmp_0001_northstar",
      ),
    ).toBe(true);
    expect(body.pagination.pageSize).toBe(5);
    expect(JSON.stringify(body)).not.toContain("Private history");
  });

  it("allows narrative correction with conflicts while preserving historical facts", async () => {
    const cookie = await signIn("owner@northstar.test", "OwnerPass!2026");
    const current = await (
      await request("/api/activities/act_0001_northstar", cookie)
    ).json();
    const response = await request(
      "/api/activities/act_0001_northstar",
      cookie,
      {
        method: "PUT",
        body: JSON.stringify({
          subject: "Corrected subject",
          body: "Corrected summary",
          occurredAt: "2030-01-01T00:00:00Z",
          companyId: null,
          version: current.activity.version,
        }),
      },
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()).activity;
    expect(updated.subject).toBe("Corrected subject");
    expect(updated.occurredAt).toBe(current.activity.occurredAt);
    expect(updated.companyId).toBe(current.activity.companyId);
    const conflict = await request(
      "/api/activities/act_0001_northstar",
      cookie,
      {
        method: "PUT",
        body: JSON.stringify({
          subject: "Stale",
          body: "Stale",
          version: current.activity.version,
        }),
      },
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("EDIT_CONFLICT");
  });

  it("blocks viewer writes and foreign relationships without side effects or disclosure", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    expect(
      (await request("/api/activities", viewer, { method: "POST", body: "{}" }))
        .status,
    ).toBe(403);
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    expect(
      (await request("/api/activities/act_0001_northstar", outside)).status,
    ).toBe(404);
    const before = Number(
      (
        database.prepare("SELECT count(*) count FROM activities").get() as {
          count: number;
        }
      ).count,
    );
    const rejected = await request("/api/activities", outside, {
      method: "POST",
      body: JSON.stringify({
        type: "call",
        subject: "Probe",
        occurredAt: "2026-08-05T12:00:00Z",
        companyId: "cmp_0001_northstar",
        participantIds: [],
        followUp: {
          title: "Must roll back",
          assigneeMembershipId: "mem_outside",
          priority: "normal",
        },
      }),
    });
    expect(rejected.status).toBe(403);
    const after = Number(
      (
        database.prepare("SELECT count(*) count FROM activities").get() as {
          count: number;
        }
      ).count,
    );
    expect(after).toBe(before);
    expect(
      database
        .prepare("SELECT 1 FROM tasks WHERE title='Must roll back'")
        .get(),
    ).toBeUndefined();
  });

  it("retains committed activity and snapshot labels after a database restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "northstar-activity-"));
    const path = join(directory, "restart.sqlite");
    let durable = openProductDatabase(path);
    try {
      seedDatabase(durable);
      const created = new ActivityStore(durable).create(
        {
          id: "usr_owner",
          membershipId: "mem_owner",
          email: "owner@northstar.test",
          name: "Avery Owner",
          role: "owner",
          organization: { id: "org_northstar", name: "Northstar Demo" },
          sessionExpiresAt: "2026-08-06T00:00:00.000Z",
        },
        {
          type: "note",
          subject: "Restart proof",
          body: "Committed history",
          occurredAt: "2026-08-05T10:00:00Z",
          companyId: "cmp_0001_northstar",
          participantIds: [],
        },
      );
      durable.close();
      durable = openProductDatabase(path);
      expect(
        new ActivityStore(durable).detail("org_northstar", created.id),
      ).toMatchObject({
        subject: "Restart proof",
        relatedLabels: { company: "Northstar Account 1" },
      });
    } finally {
      durable.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
