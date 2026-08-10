import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

let server: Server | undefined;
let directory: string | undefined;
let database: DatabaseSync | undefined;
let databasePath = "";
afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  database?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  server = undefined;
  database = undefined;
  directory = undefined;
});
function start(db: DatabaseSync) {
  server = createApp(db, false).listen(0, "127.0.0.1");
  return new Promise<string>((done) =>
    server!.once("listening", () => {
      const address = server!.address();
      done(
        `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
      );
    }),
  );
}
async function setup() {
  directory = mkdtempSync(join(tmpdir(), "northstar-activities-"));
  databasePath = join(directory, "test.sqlite");
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T08:00:00.000Z";
  for (const [id, name] of [
    ["organization_a", "A"],
    ["organization_b", "B"],
  ] as const)
    database
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(id, name, id, now, now);
  for (const [id, email, name] of [
    ["user_owner_a", "owner-a@test.local", "Original Owner"],
    ["user_member_a", "member-a@test.local", "Member A"],
    ["user_viewer_a", "viewer-a@test.local", "Viewer A"],
    ["user_owner_b", "owner-b@test.local", "Outside Owner"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, email, "hash", name, now, now);
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
    ["member-token", "user_member_a", "organization_a"],
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
  database
    .prepare(
      "INSERT INTO companies(id,organization_id,name,lifecycle_status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      "company_a",
      "organization_a",
      "Original Company",
      "customer",
      now,
      now,
    );
  database
    .prepare(
      "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,status,tags_json,communication_preference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "contact_a",
      "organization_a",
      "company_a",
      "Original",
      "Contact",
      "active",
      "[]",
      "email",
      now,
      now,
    );
  return start(database);
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
const payload = {
  type: "meeting",
  subject: "Quarterly review",
  body: "Reviewed expansion plans.",
  occurredAt: "2026-08-09T13:30:00+02:00",
  companyId: "company_a",
  contactId: "contact_a",
  participantIds: ["contact_a"],
  followUp: {
    title: "Send proposal",
    assigneeId: "user_member_a",
    dueAt: "2026-08-12T09:00:00+02:00",
    priority: "high",
  },
};

describe.sequential("activity timeline API", () => {
  it("creates a follow-up, filters, corrects with conflicts, preserves facts, and survives restart", async () => {
    const base = await setup();
    const createdResponse = await fetch(
      `${base}/api/activities`,
      options("member-token", "POST", payload),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      version: number;
      occurredAt: string;
      followUpTask: { id: string };
    };
    expect(created.occurredAt).toBe("2026-08-09T11:30:00.000Z");
    expect(created.followUpTask.id).toBeTruthy();
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM tasks WHERE organization_id='organization_a'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    const list = await (
      await fetch(
        `${base}/api/activities?type=meeting&companyId=company_a&contactId=contact_a&authorId=user_member_a&from=2026-08-09T00:00:00Z`,
        options("owner-token"),
      )
    ).json();
    expect(list).toMatchObject({
      total: 1,
      items: [{ id: created.id, creator: { name: "Member A" } }],
    });
    expect(
      (
        await fetch(
          `${base}/api/activities/${created.id}`,
          options("member-token", "PUT", {
            subject: "Corrected review",
            body: "Corrected narrative",
            version: created.version,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base}/api/activities/${created.id}`,
          options("member-token", "PUT", {
            subject: "Stale",
            body: "Lost",
            version: created.version,
          }),
        )
      ).status,
    ).toBe(409);
    database!
      .prepare(
        "UPDATE users SET display_name='Renamed Member' WHERE id='user_member_a'",
      )
      .run();
    database!
      .prepare(
        "UPDATE companies SET name='Renamed Company' WHERE id='company_a'",
      )
      .run();
    const detail = await (
      await fetch(
        `${base}/api/activities/${created.id}`,
        options("owner-token"),
      )
    ).json();
    expect(detail).toMatchObject({
      subject: "Corrected review",
      occurredAt: "2026-08-09T11:30:00.000Z",
      creator: { name: "Member A" },
      company: { name: "Original Company" },
      participants: [{ name: "Original Contact" }],
    });
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    database!.close();
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON");
    const restarted = await start(database);
    expect(
      (
        await fetch(
          `${restarted}/api/activities/${created.id}`,
          options("owner-token"),
        )
      ).status,
    ).toBe(200);
  });

  it("denies viewers and foreign references without partial writes or disclosure", async () => {
    const base = await setup();
    expect(
      (
        await fetch(
          `${base}/api/activities`,
          options("viewer-token", "POST", payload),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `${base}/api/activities`,
          options("outside-token", "POST", payload),
        )
      ).status,
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
    expect(
      await (
        await fetch(`${base}/api/activities`, options("outside-token"))
      ).json(),
    ).toMatchObject({ total: 0, items: [] });
    expect(
      (
        await fetch(
          `${base}/api/activities`,
          options("owner-token", "POST", {
            ...payload,
            followUp: { ...payload.followUp, assigneeId: "user_owner_b" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        database!.prepare("SELECT count(*) count FROM activities").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    expect(
      (
        database!.prepare("SELECT count(*) count FROM tasks").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
  });
});
