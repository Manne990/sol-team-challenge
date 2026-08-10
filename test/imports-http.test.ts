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
async function setup() {
  directory = mkdtempSync(join(tmpdir(), "northstar-imports-"));
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
    ["owner_a_user", "a@test.local"],
    ["viewer_a_usr", "v@test.local"],
    ["owner_b_user", "b@test.local"],
  ] as const)
    database
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, email, "hash", id, now, now);
  for (const [org, user, role] of [
    ["organization_a", "owner_a_user", "owner"],
    ["organization_a", "viewer_a_usr", "viewer"],
    ["organization_b", "owner_b_user", "owner"],
  ] as const)
    database
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES(?,?,?,?)",
      )
      .run(org, user, role, now);
  for (const [token, user, org] of [
    ["owner-token", "owner_a_user", "organization_a"],
    ["viewer-token", "viewer_a_usr", "organization_a"],
    ["outside-token", "owner_b_user", "organization_b"],
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
        "2099-01-01T00:00:00Z",
        now,
      );
  database
    .prepare(
      "INSERT INTO companies(id,organization_id,name,organization_number,lifecycle_status,owner_id,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "company_existing",
      "organization_a",
      "Existing",
      "EX-1",
      "customer",
      "owner_a_user",
      JSON.stringify(["priority"]),
      "=formula-safe export",
      now,
      now,
    );
  server = createApp(database, false).listen(0, "127.0.0.1");
  await new Promise<void>((done) => server!.once("listening", done));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
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

describe.sequential("CSV import and export", () => {
  it("previews every row, commits valid rows transactionally, and replays safely", async () => {
    const base = await setup();
    const payload = {
      kind: "companies",
      idempotencyKey: "batch-1",
      csv: "name,organizationNumber,tags\nNew Co,NEW-1,priority;new\n,INVALID-1,bad\nDuplicate,EX-1,existing",
    };
    const preview = await fetch(
      `${base}/api/imports/preview`,
      options("owner-token", "POST", payload),
    );
    expect(preview.status).toBe(201);
    const batch = (await preview.json()) as {
      id: string;
      validCount: number;
      errorCount: number;
      rows: Array<{ warnings: string[] }>;
    };
    expect(batch).toMatchObject({ validCount: 1, errorCount: 2 });
    expect(batch.rows[2]!.warnings[0]).toContain("already belongs");
    const commit = await fetch(
      `${base}/api/imports/${batch.id}/commit`,
      options("owner-token", "POST", {}),
    );
    expect(commit.status).toBe(200);
    expect((await commit.json()) as object).toMatchObject({
      status: "committed",
      validCount: 1,
      errorCount: 2,
    });
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM companies WHERE organization_id='organization_a'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(2);
    const replay = await fetch(
      `${base}/api/imports/${batch.id}/commit`,
      options("owner-token", "POST", {}),
    );
    expect(replay.status).toBe(200);
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM companies WHERE organization_id='organization_a'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(2);
    const samePreview = await fetch(
      `${base}/api/imports/preview`,
      options("owner-token", "POST", payload),
    );
    expect((await samePreview.json()) as object).toMatchObject({
      id: batch.id,
      status: "committed",
    });
    const digestReplay = await fetch(
      `${base}/api/imports/preview`,
      options("owner-token", "POST", { ...payload, idempotencyKey: "batch-2" }),
    );
    expect((await digestReplay.json()) as object).toMatchObject({
      id: batch.id,
    });
  });
  it("rolls back every valid row when persisted data changes after preview", async () => {
    const base = await setup();
    const preview = await fetch(
      `${base}/api/imports/preview`,
      options("owner-token", "POST", {
        kind: "companies",
        csv: "name,organizationNumber\nFirst,ROLL-1\nSecond,ROLL-2",
      }),
    );
    const batch = (await preview.json()) as { id: string };
    database!
      .prepare(
        "INSERT INTO companies(id,organization_id,name,organization_number,lifecycle_status,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "late_company",
        "organization_a",
        "Late",
        "ROLL-2",
        "prospect",
        "[]",
        "",
        "2026-08-10",
        "2026-08-10",
      );
    const commit = await fetch(
      `${base}/api/imports/${batch.id}/commit`,
      options("owner-token", "POST", {}),
    );
    expect(commit.status).toBe(409);
    expect(
      (
        database!
          .prepare(
            "SELECT count(*) count FROM companies WHERE organization_id='organization_a' AND organization_number='ROLL-1'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        database!
          .prepare("SELECT status FROM imports WHERE id=?")
          .get(batch.id) as { status: string }
      ).status,
    ).toBe("preview");
  });
  it("reports malformed, formula-like, oversized, forbidden, and foreign cases without side effects", async () => {
    const base = await setup();
    const malformed = await fetch(
      `${base}/api/imports/preview`,
      options("owner-token", "POST", {
        kind: "contacts",
        csv: 'firstName,lastName\n"broken,row',
      }),
    );
    expect(malformed.status).toBe(400);
    const formula = await fetch(
      `${base}/api/imports/preview`,
      options("owner-token", "POST", {
        kind: "contacts",
        csv: "firstName,lastName,email\n=CMD(),Example,user@example.test",
      }),
    );
    const formulaBody = (await formula.json()) as {
      rows: Array<{ errors: string[] }>;
    };
    expect(formulaBody.rows[0]!.errors[0]).toContain("formula");
    expect(
      (
        await fetch(
          `${base}/api/imports/preview`,
          options("owner-token", "POST", {
            kind: "companies",
            csv: `name\n${"x".repeat(513 * 1024)}`,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${base}/api/imports/preview`,
          options("viewer-token", "POST", {
            kind: "companies",
            csv: "name\nNope",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `${base}/api/imports/missing/commit`,
          options("outside-token", "POST", {}),
        )
      ).status,
    ).toBe(404);
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
  it("exports only active tenant-filtered rows with stable spreadsheet-safe CSV", async () => {
    const base = await setup();
    database!
      .prepare(
        "INSERT INTO companies(id,organization_id,name,lifecycle_status,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "company_foreign",
        "organization_b",
        "Foreign",
        "customer",
        "[]",
        "secret",
        "2026-01-01",
        "2026-01-01",
      );
    const response = await fetch(
      `${base}/api/imports/exports/companies.csv?lifecycle=customer&tag=priority`,
      options("owner-token"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv).toContain("id,name,organization_number");
    expect(csv).toContain("Existing");
    expect(csv).toContain("'=formula-safe export");
    expect(csv).not.toContain("Foreign");
  });
});
