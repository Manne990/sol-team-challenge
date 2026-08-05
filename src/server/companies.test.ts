import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import type { AuthenticatedUser } from "../shared/auth.js";
import { createApp } from "./app.js";
import { hashSessionSecret } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { CompanyStore } from "./companies.js";

const now = "2026-08-05T20:00:00.000Z";
const actor: AuthenticatedUser = {
  id: "usr_member",
  membershipId: "mem_member",
  email: "member@northstar.test",
  name: "Morgan Member",
  role: "member",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2026-08-06T20:00:00Z",
};
const payload = {
  name: "Polar Industries",
  organizationNumber: "POL-1",
  externalReference: "P-1",
  website: "https://polar.example.test",
  phone: "+46 1",
  industry: "Technology",
  size: "medium",
  address: { city: "Umeå" },
  lifecycleStatus: "prospect",
  ownerMembershipId: "mem_member",
  tags: ["priority"],
  description: "New account",
};

describe("company management", () => {
  let db: Database.Database, store: CompanyStore;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    seedDatabase(db as never);
    store = new CompanyStore(db as unknown as SqliteDatabase);
  });
  afterEach(() => db.close());

  it("combines tenant-scoped filters, sorting, and pagination", () => {
    const result = store.list("org_northstar", {
      q: "Account",
      lifecycle: "customer",
      tag: "priority",
      sort: "created_at",
      order: "desc",
      page: "1",
      pageSize: "5",
    });
    expect(result.items).toHaveLength(5);
    expect(result.total).toBeGreaterThan(5);
    expect(
      result.items.every(
        (item) =>
          item.lifecycleStatus === "customer" && item.tags.includes("priority"),
      ),
    ).toBe(true);
    expect(store.list("org_northstar", { q: "Outside Secret" }).total).toBe(0);
  });

  it("creates, detects duplicates, exposes history, and preserves relations when archived", () => {
    const created = store.write(actor, undefined, payload);
    expect(created.version).toBe(1);
    expect(created.history[0].action).toBe("company.created");
    expect(() =>
      store.write(actor, undefined, { ...payload, name: "Duplicate" }),
    ).toThrowError(/Organization number or external reference/);
    const archived = store.archive(actor, created.id);
    expect(archived.archivedAt).toBeTruthy();
    expect(
      store
        .list("org_northstar", {})
        .items.some((item) => item.id === created.id),
    ).toBe(false);
    expect(
      store
        .list("org_northstar", { includeArchived: "true", q: "Polar" })
        .items.some((item) => item.id === created.id),
    ).toBe(true);
    expect(store.archive(actor, created.id, true).archivedAt).toBeNull();
  });

  it("rejects stale edits and foreign identifiers without changing foreign data", () => {
    const before = db
      .prepare("SELECT * FROM companies WHERE id='cmp_outside'")
      .get();
    expect(() =>
      store.write(actor, "cmp_0001_northstar", payload, 999),
    ).toThrowError(/changed/);
    expect(store.detail("org_northstar", "cmp_outside")).toBeUndefined();
    expect(
      db.prepare("SELECT * FROM companies WHERE id='cmp_outside'").get(),
    ).toEqual(before);
  });
});

describe("company API authorization", () => {
  let db: Database.Database,
    server: ReturnType<typeof createServer>,
    base: string;
  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
    seedDatabase(db as never);
    const session = db.prepare(
      "INSERT INTO sessions(id,token_hash,organization_id,membership_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)",
    );
    session.run(
      "s-view",
      hashSessionSecret("viewer-secret"),
      "org_northstar",
      "mem_viewer",
      now,
      "2099-01-01T00:00:00Z",
      now,
    );
    session.run(
      "s-member",
      hashSessionSecret("member-secret"),
      "org_northstar",
      "mem_member",
      now,
      "2099-01-01T00:00:00Z",
      now,
    );
    session.run(
      "s-out",
      hashSessionSecret("outside-secret"),
      "org_outside",
      "mem_outside",
      now,
      "2099-01-01T00:00:00Z",
      now,
    );
    server = createServer(createApp(db as unknown as SqliteDatabase));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not start");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
  const request = (path: string, secret: string, init: RequestInit = {}) =>
    fetch(`${base}/api/companies${path}`, {
      ...init,
      headers: {
        cookie: `northstar_session=${secret}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  it("allows viewers to read but not mutate", async () => {
    expect((await request("", "viewer-secret")).status).toBe(200);
    expect(
      (
        await request("", "viewer-secret", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(403);
  });
  it("does not reveal foreign records or counts", async () => {
    const outside = await request("", "outside-secret");
    expect((await outside.json()).total).toBe(1);
    expect(
      (await request("/cmp_0001_northstar", "outside-secret")).status,
    ).toBe(404);
  });
  it("lets members create validated companies and returns deterministic conflicts", async () => {
    const first = await request("", "member-secret", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const duplicate = await request("", "member-secret", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("COMPANY_CONFLICT");
  });
});
