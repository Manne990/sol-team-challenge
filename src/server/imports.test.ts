// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import { createApp } from "./app.js";
import { openProductDatabase } from "./database.js";
import { parseCsv } from "./imports.js";

type Database = ReturnType<typeof openProductDatabase>;
let database: Database;
let server: Server;
let baseUrl: string;
beforeEach(async () => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
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
async function signIn(
  email = "owner@northstar.test",
  password = "OwnerPass!2026",
) {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0];
}
const request = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init.headers },
  });

test("CSV parser supports quoted delimiters, escaped quotes, and newlines", () => {
  expect(
    parseCsv('name,description\r\n"Acme, AB","Line 1\nLine ""two"""'),
  ).toEqual([
    ["name", "description"],
    ["Acme, AB", 'Line 1\nLine "two"'],
  ]);
  expect(() => parseCsv('name,description\n"unclosed,value')).toThrow(
    /not closed/u,
  );
  expect(() =>
    parseCsv(`name,description\nAcme,${"x".repeat(513 * 1024)}`),
  ).toThrow(/512 KB/u);
});

describe("CSV import and export", () => {
  test("previews row errors and warnings, commits valid rows once, and audits safely", async () => {
    const cookie = await signIn();
    const csv =
      "First Name,Last Name,Email,Status,Tags,Company Number\nAda,Lovelace,ada@example.test,active,vip;buyer,SE-5590000001\nDuplicate,Contact,contact1@example.test,lead,,\nBroken,,not-an-email,bad,,";
    const preview = await request("/api/imports/preview", cookie, {
      method: "POST",
      body: JSON.stringify({
        resource: "contacts",
        csv,
        mapping: {
          firstName: "First Name",
          lastName: "Last Name",
          email: "Email",
          status: "Status",
          tags: "Tags",
          companyOrganizationNumber: "Company Number",
        },
      }),
    });
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.summary).toMatchObject({
      total: 3,
      valid: 1,
      warnings: 1,
      invalid: 1,
    });
    expect(body.rows[1].warnings[0]).toMatch(/existing contact/u);
    expect(body.rows[2].errors.join(" ")).toMatch(/First and last name/u);
    const commit = await request(
      `/api/imports/${body.importId}/commit`,
      cookie,
      { method: "POST" },
    );
    expect(commit.status).toBe(200);
    expect((await commit.json()).summary).toEqual({
      committed: 2,
      invalid: 1,
      total: 3,
    });
    const replay = await request(
      `/api/imports/${body.importId}/commit`,
      cookie,
      { method: "POST" },
    );
    expect((await replay.json()).replayed).toBe(true);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM contacts WHERE organization_id='org_northstar' AND email='ada@example.test'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    const audit = database
      .prepare(
        "SELECT summary_json FROM audit_events WHERE entity_id=? AND action='import.committed'",
      )
      .get(body.importId) as { summary_json: string };
    expect(audit.summary_json).not.toContain(csv);
    expect(JSON.parse(audit.summary_json)).toMatchObject({
      resource: "contacts",
      committed: 2,
    });
  });

  test("keeps previews and commits tenant isolated and rejects viewer mutation", async () => {
    const owner = await signIn();
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    const payload = {
      resource: "companies",
      csv: "Name,Number\nPrivate Import,PRIVATE-77",
      mapping: { name: "Name", organizationNumber: "Number" },
    };
    const preview = await request("/api/imports/preview", owner, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const id = (await preview.json()).importId;
    expect(
      (await request(`/api/imports/${id}/commit`, outside, { method: "POST" }))
        .status,
    ).toBe(400);
    expect(
      (
        await request("/api/imports/preview", viewer, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM companies WHERE organization_id='org_outside' AND name='Private Import'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  test("exports tenant-filtered rows with stable escaping and formula neutralization", async () => {
    const cookie = await signIn();
    database
      .prepare(
        "INSERT INTO companies(id,organization_id,name,industry,lifecycle_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "cmp_formula",
        "org_northstar",
        '=HYPERLINK("bad")',
        "Testing",
        "lead",
        "2026-08-09T00:00:00Z",
        "2026-08-09T00:00:00Z",
      );
    const response = await request(
      "/api/imports/export/companies.csv?lifecycle=lead&q=HYPERLINK",
      cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain("Outside");
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  test("rolls back all rows when a duplicate appears after preview", async () => {
    const cookie = await signIn();
    const payload = {
      resource: "companies",
      csv: "Name,Number\nFirst Safe,NEW-901\nSecond Conflict,LATE-1",
      mapping: { name: "Name", organizationNumber: "Number" },
    };
    const preview = await request("/api/imports/preview", cookie, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const id = (await preview.json()).importId;
    database
      .prepare(
        "INSERT INTO companies(id,organization_id,name,organization_number,lifecycle_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "cmp_late",
        "org_northstar",
        "Late",
        "LATE-1",
        "lead",
        "2026-08-09T00:00:00Z",
        "2026-08-09T00:00:00Z",
      );
    const commit = await request(`/api/imports/${id}/commit`, cookie, {
      method: "POST",
    });
    expect(commit.status).toBe(409);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM companies WHERE organization_id='org_northstar' AND organization_number='NEW-901'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        database.prepare("SELECT status FROM imports WHERE id=?").get(id) as {
          status: string;
        }
      ).status,
    ).toBe("preview");
  });
});
