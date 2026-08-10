import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

let server: Server | undefined;
let database: DatabaseSync | undefined;
let directory: string | undefined;
const now = "2026-08-10T10:00:00.000Z";
afterEach(() => {
  server?.close();
  database?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  server = undefined;
  database = undefined;
  directory = undefined;
});
function setup() {
  directory = mkdtempSync(join(tmpdir(), "northstar-merges-"));
  database = new DatabaseSync(join(directory, "test.sqlite"));
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations")).sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  for (const [id, slug] of [
    ["organization_a", "a"],
    ["organization_b", "b"],
  ] as const)
    database
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(id, slug, slug, now, now);
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
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES(?,?,'owner',?)",
      )
      .run(org, user, now);
    database
      .prepare(
        "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        `session-${user}`,
        user,
        org,
        createHash("sha256")
          .update(org === "organization_a" ? "token-a" : "token-b")
          .digest("hex"),
        "2099-01-01T00:00:00.000Z",
        now,
      );
  }
  server = createApp(database, false).listen(0, "127.0.0.1");
  return new Promise<string>((done) =>
    server!.once("listening", () => {
      const address = server!.address();
      done(
        `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
      );
    }),
  );
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
function company(
  id: string,
  org: string,
  name: string,
  organizationNumber: string | null = null,
) {
  database!
    .prepare(
      "INSERT INTO companies(id,organization_id,name,organization_number,lifecycle_status,created_at,updated_at) VALUES(?,?,?,?,'prospect',?,?)",
    )
    .run(id, org, name, organizationNumber, now, now);
}
const companyFields = (
  name: string,
  organizationNumber: string | null = null,
) => ({
  name,
  organization_number: organizationNumber,
  external_reference: null,
  website: null,
  phone: null,
  industry: null,
  size: null,
  address: null,
  lifecycle_status: "prospect",
  owner_id: null,
  tags_json: [],
  description: "",
});

describe.sequential("duplicate review and merge API", () => {
  it("explains candidates, preserves relations, supports replay and safe redirects", async () => {
    const base = await setup();
    company("company_keep", "organization_a", " ACME  Nordic ");
    company("company_old", "organization_a", "acme nordic", "SE-OLD");
    database!
      .prepare(
        "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,created_at,updated_at) VALUES('contact_move','organization_a','company_old','Ada','Lovelace',?,?)",
      )
      .run(now, now);
    database!
      .prepare(
        "INSERT INTO activities(id,organization_id,type,subject,occurred_at,creator_id,creator_name_snapshot,company_id,company_name_snapshot,created_at,updated_at) VALUES('activity_old','organization_a','note','History',?,'user_owner_a','Owner','company_old','Original label',?,?)",
      )
      .run(now, now, now);
    const review = (await (
      await fetch(`${base}/api/duplicates/company`, options("token-a"))
    ).json()) as { candidates: Array<{ triggers: unknown[] }> };
    expect(review.candidates).toHaveLength(1);
    expect(review.candidates[0]!.triggers).toContainEqual({
      field: "name",
      normalizedValue: "acme nordic",
    });
    const payload = {
      idempotencyKey: "merge-1",
      survivorId: "company_keep",
      retiredId: "company_old",
      survivorVersion: 1,
      retiredVersion: 1,
      fields: companyFields("Acme Nordic", "SE-OLD"),
    };
    const merged = await fetch(
      `${base}/api/duplicates/company/merge`,
      options("token-a", "POST", payload),
    );
    expect(merged.status).toBe(201);
    expect(
      await (
        await fetch(
          `${base}/api/duplicates/company/merge`,
          options("token-a", "POST", payload),
        )
      ).json(),
    ).toMatchObject({ replayed: true, survivorId: "company_keep" });
    expect(
      database!
        .prepare("SELECT company_id FROM contacts WHERE id='contact_move'")
        .get(),
    ).toMatchObject({ company_id: "company_keep" });
    expect(
      database!
        .prepare(
          "SELECT company_id,company_name_snapshot FROM activities WHERE id='activity_old'",
        )
        .get(),
    ).toMatchObject({
      company_id: "company_keep",
      company_name_snapshot: "Original label",
    });
    expect(
      await (
        await fetch(
          `${base}/api/duplicates/company/redirects/company_old`,
          options("token-a"),
        )
      ).json(),
    ).toMatchObject({ survivorId: "company_keep" });
    expect(
      (
        await fetch(
          `${base}/api/companies/company_old/restore`,
          options("token-a", "POST", {}),
        )
      ).status,
    ).toBe(409);
  });

  it("deduplicates contact edges, flattens chains, and rejects stale, archived, false-positive and foreign merges", async () => {
    const base = await setup();
    company("company_a", "organization_a", "Host");
    company("company_foreign", "organization_b", "Host");
    const add = (
      id: string,
      org = "organization_a",
      email: string | null = null,
      archived: string | null = null,
    ) =>
      database!
        .prepare(
          "INSERT INTO contacts(id,organization_id,first_name,last_name,email,archived_at,created_at,updated_at) VALUES(?,?,?,'Person',?,?,?,?)",
        )
        .run(id, org, id, email, archived, now, now);
    add("contact_one", "organization_a", "same@example.test");
    add("contact_two", "organization_a", "SAME@example.test");
    add("contact_three", "organization_a", null);
    add("contact_foreign", "organization_b", "same@example.test");
    add("contact_archived", "organization_a", null, now);
    const fields = (first: string) => ({
      company_id: null,
      first_name: first,
      last_name: "Person",
      email: null,
      phone: null,
      job_title: null,
      owner_id: null,
      status: "active",
      tags_json: [],
      communication_preference: "email",
    });
    const falsePositive = (await (
      await fetch(`${base}/api/duplicates/contact`, options("token-a"))
    ).json()) as { candidates: Array<{ records: Array<{ id: string }> }> };
    expect(falsePositive.candidates).toHaveLength(1);
    expect(
      falsePositive.candidates[0]!.records.map((x) => x.id).sort(),
    ).toEqual(["contact_one", "contact_two"]);
    expect(
      (
        await fetch(
          `${base}/api/duplicates/contact/merge`,
          options("token-a", "POST", {
            idempotencyKey: "stale",
            survivorId: "contact_one",
            retiredId: "contact_two",
            survivorVersion: 99,
            retiredVersion: 1,
            fields: fields("one"),
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(
          `${base}/api/duplicates/contact/merge`,
          options("token-a", "POST", {
            idempotencyKey: "foreign",
            survivorId: "contact_one",
            retiredId: "contact_foreign",
            survivorVersion: 1,
            retiredVersion: 1,
            fields: fields("one"),
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(
          `${base}/api/duplicates/contact/merge`,
          options("token-a", "POST", {
            idempotencyKey: "archived",
            survivorId: "contact_one",
            retiredId: "contact_archived",
            survivorVersion: 1,
            retiredVersion: 1,
            fields: fields("one"),
          }),
        )
      ).status,
    ).toBe(409);
    let result = await fetch(
      `${base}/api/duplicates/contact/merge`,
      options("token-a", "POST", {
        idempotencyKey: "chain-1",
        survivorId: "contact_one",
        retiredId: "contact_two",
        survivorVersion: 1,
        retiredVersion: 1,
        fields: fields("one"),
      }),
    );
    expect(result.status).toBe(201);
    result = await fetch(
      `${base}/api/duplicates/contact/merge`,
      options("token-a", "POST", {
        idempotencyKey: "chain-2",
        survivorId: "contact_three",
        retiredId: "contact_one",
        survivorVersion: 1,
        retiredVersion: 2,
        fields: fields("three"),
      }),
    );
    expect(result.status).toBe(201);
    expect(
      database!
        .prepare(
          "SELECT survivor_id FROM merge_redirects WHERE retired_id='contact_two'",
        )
        .get(),
    ).toMatchObject({ survivor_id: "contact_three" });
    const reopened = new DatabaseSync(join(directory!, "test.sqlite"));
    expect(
      reopened
        .prepare(
          "SELECT survivor_id FROM merge_redirects WHERE retired_id='contact_two'",
        )
        .get(),
    ).toMatchObject({ survivor_id: "contact_three" });
    reopened.close();
  });
});
