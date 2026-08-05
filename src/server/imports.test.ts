import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import { createApp } from "./app.js";
import { hashSessionSecret } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
describe("safe CSV movement", () => {
  let db: Database.Database,
    server: ReturnType<typeof createServer>,
    base: string;
  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    seedDatabase(db as never);
    const add = db.prepare(
      "INSERT INTO sessions(id,token_hash,organization_id,membership_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)",
    );
    for (const [id, secret, org, member] of [
      ["one", "member-secret", "org_northstar", "mem_member"],
      ["two", "outside-secret", "org_outside", "mem_outside"],
      ["three", "viewer-secret", "org_northstar", "mem_viewer"],
    ])
      add.run(
        id,
        hashSessionSecret(secret),
        org,
        member,
        "2026-08-05T20:00:00Z",
        "2099-01-01T00:00:00Z",
        "2026-08-05T20:00:00Z",
      );
    server = createServer(createApp(db as unknown as SqliteDatabase));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server failed");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
  const call = (
    path: string,
    secret = "member-secret",
    init: RequestInit = {},
  ) =>
    fetch(`${base}/api/imports${path}`, {
      ...init,
      headers: {
        cookie: `northstar_session=${secret}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  it("explains duplicate and formula rows, then commits valid rows once", async () => {
    const csv =
        "name,organizationNumber,description\r\nFresh Import,FRESH-1,Safe\r\nKnown Duplicate,SE-5590000001,Review\r\nFormula Row,BAD-1,=HYPERLINK(x)\r\n",
      payload = {
        resource: "companies",
        csv,
        mapping: {
          name: "name",
          organizationNumber: "organizationNumber",
          description: "description",
        },
      };
    const first = await call("/preview", "member-secret", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const preview = await first.json();
    expect(preview.rows.map((row: Row) => row.status)).toEqual([
      "valid",
      "warning",
      "invalid",
    ]);
    expect(preview.rows[1].warnings[0]).toMatch(/organization number/);
    expect(preview.rows[2].errors[0]).toMatch(/formula/);
    const replay = await call("/preview", "member-secret", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect((await replay.json()).replayed).toBe(true);
    const committed = await call(
      `/${preview.importId}/commit`,
      "member-secret",
      { method: "POST", body: "{}" },
    );
    expect(await committed.json()).toMatchObject({
      committed: 1,
      warnings: 1,
      invalid: 1,
      replayed: false,
    });
    const twice = await call(`/${preview.importId}/commit`, "member-secret", {
      method: "POST",
      body: "{}",
    });
    expect((await twice.json()).replayed).toBe(true);
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM companies WHERE organization_id='org_northstar' AND organization_number='FRESH-1'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
  it("rejects malformed, oversized, and viewer imports", async () => {
    for (const csv of ['name\n"unclosed', `name\n${"x".repeat(1_000_001)}`])
      expect(
        (
          await call("/preview", "member-secret", {
            method: "POST",
            body: JSON.stringify({
              resource: "companies",
              csv,
              mapping: { name: "name" },
            }),
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call("/preview", "viewer-secret", {
          method: "POST",
          body: JSON.stringify({
            resource: "companies",
            csv: "name\nNope",
            mapping: { name: "name" },
          }),
        })
      ).status,
    ).toBe(403);
  });
  it("exports escaped filtered CSV without foreign rows", async () => {
    db.prepare(
      "UPDATE companies SET description='=FORMULA' WHERE id='cmp_0001_northstar'",
    ).run();
    const response = await call("/export/companies?lifecycle=customer");
    const text = await response.text();
    expect(response.headers.get("content-disposition")).toContain(
      "companies.csv",
    );
    expect(text).toContain("'=FORMULA");
    expect(text).not.toContain("Outside Secret");
    const outside = await call("/export/companies", "outside-secret");
    expect(await outside.text()).toContain("Outside Secret AB");
  });
});
