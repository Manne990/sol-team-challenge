// @vitest-environment node
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

let database: DatabaseSync;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = "2026-08-10T08:00:00.000Z";
  const addOrganization = database.prepare(
    "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
  );
  addOrganization.run("org_northstar_demo", "Northstar", "northstar", now, now);
  addOrganization.run("org_outside_demo", "Outside", "outside", now, now);
  const addUser = database.prepare(
    "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  );
  for (const [id, email, password, name] of [
    ["usr_northstar_owner", "owner@northstar.test", "OwnerPass!2026", "Owner"],
    [
      "usr_northstar_member",
      "member@northstar.test",
      "MemberPass!2026",
      "Member",
    ],
    [
      "usr_northstar_viewer",
      "viewer@northstar.test",
      "ViewerPass!2026",
      "Viewer",
    ],
    [
      "usr_outside_owner",
      "other-owner@outside.test",
      "OutsidePass!2026",
      "Outside",
    ],
  ] as const)
    addUser.run(id, email, await bcrypt.hash(password, 4), name, now, now);
  const addMembership = database.prepare(
    "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
  );
  addMembership.run("org_northstar_demo", "usr_northstar_owner", "owner", now);
  addMembership.run(
    "org_northstar_demo",
    "usr_northstar_member",
    "member",
    now,
  );
  addMembership.run(
    "org_northstar_demo",
    "usr_northstar_viewer",
    "viewer",
    now,
  );
  addMembership.run("org_outside_demo", "usr_outside_owner", "owner", now);
  database
    .prepare(
      "INSERT INTO companies(id,organization_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
    )
    .run(
      "cmp_0001_northstar",
      "org_northstar_demo",
      "Northstar Account 1",
      now,
      now,
    );
  const addContact = database.prepare(
    `INSERT INTO contacts
      (id,organization_id,company_id,first_name,last_name,email,owner_id,status,tags_json,communication_preference,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let index = 1; index <= 8; index++)
    addContact.run(
      `con_000${index}_northstar`,
      "org_northstar_demo",
      "cmp_0001_northstar",
      `Person${index}`,
      "Northstar",
      `contact${index}@example.test`,
      "usr_northstar_owner",
      "active",
      '["vip"]',
      "email",
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO contacts
    (id,organization_id,first_name,last_name,email,status,tags_json,communication_preference,created_at,updated_at)
    VALUES('con_outside','org_outside_demo','Private','Person','private@outside.test','active','[]','email','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z')`,
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
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(201);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("session cookie missing");
  return cookie;
}

const request = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie,
      origin: baseUrl,
      ...init.headers,
    },
  });

describe.sequential("contact API", () => {
  it("rejects cross-origin mutations without side effects", async () => {
    const cookie = await signIn("owner@northstar.test", "OwnerPass!2026");
    const before = Number(
      (
        database.prepare("SELECT count(*) count FROM contacts").get() as {
          count: number;
        }
      ).count,
    );
    const response = await request("/api/contacts", cookie, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({
        firstName: "CrossOrigin",
        lastName: "Rejected",
        tags: [],
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden" },
    });
    const after = Number(
      (
        database.prepare("SELECT count(*) count FROM contacts").get() as {
          count: number;
        }
      ).count,
    );
    expect(after).toBe(before);
  });

  it("paginates and combines organization-scoped filters", async () => {
    const cookie = await signIn("owner@northstar.test", "OwnerPass!2026");
    const response = await request(
      "/api/contacts?page=2&pageSize=5&status=active&tag=vip&sort=email&direction=desc",
      cookie,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toMatchObject({
      page: 2,
      pageSize: 5,
      total: 8,
      pages: 2,
    });
    expect(body.contacts).toHaveLength(3);
    expect(
      body.contacts.every((contact: { tags: string[] }) =>
        contact.tags.includes("vip"),
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Outside");
  });

  it("provides a quiet not-found result for browser record navigation", async () => {
    const cookie = await signIn("owner@northstar.test", "OwnerPass!2026");
    const navigation = await request(
      "/api/contacts/not-a-real-contact?navigation=true",
      cookie,
    );
    expect(navigation.status).toBe(200);
    expect(await navigation.json()).toEqual({ contact: null });
    expect(
      (await request("/api/contacts/not-a-real-contact", cookie)).status,
    ).toBe(404);
  });

  it("creates, normalizes, warns, updates, archives, restores, and retains related history", async () => {
    const cookie = await signIn("member@northstar.test", "MemberPass!2026");
    const create = await request("/api/contacts", cookie, {
      method: "POST",
      body: JSON.stringify({
        firstName: "  New ",
        lastName: "Contact",
        email: " CONTACT1@EXAMPLE.TEST ",
        phone: "+46 70 123",
        jobTitle: "Buyer",
        ownerMembershipId: "usr_northstar_member",
        companyId: "cmp_0001_northstar",
        status: "active",
        tags: ["VIP", "vip"],
        communicationPreference: "phone",
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.contact).toMatchObject({
      firstName: "New",
      email: "contact1@example.test",
      tags: ["vip"],
    });
    expect(created.warnings[0]).toMatchObject({
      code: "EMAIL_MATCH",
      contactId: "con_0001_northstar",
    });

    const detail = await request(`/api/contacts/${created.contact.id}`, cookie);
    const detailBody = await detail.json();
    expect(detailBody.contact.company.name).toBe("Northstar Account 1");
    expect(
      detailBody.history.some(
        (event: { action: string }) => event.action === "contact.created",
      ),
    ).toBe(true);

    const update = await request(
      `/api/contacts/${created.contact.id}`,
      cookie,
      {
        method: "PUT",
        body: JSON.stringify({
          ...created.contact,
          firstName: "Updated",
          tags: ["customer"],
          ownerMembershipId: "usr_northstar_owner",
          companyId: null,
        }),
      },
    );
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(updated.contact).toMatchObject({
      firstName: "Updated",
      company: null,
      version: 2,
    });

    expect(
      (
        await request(`/api/contacts/${created.contact.id}`, cookie, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    const normalList = await (
      await request(`/api/contacts?q=Updated`, cookie)
    ).json();
    expect(normalList.pagination.total).toBe(0);
    expect(
      (
        await request(`/api/contacts/${created.contact.id}/restore`, cookie, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const restored = await (
      await request(`/api/contacts?q=Updated`, cookie)
    ).json();
    expect(restored.pagination.total).toBe(1);
  });

  it("prevents viewer writes and makes foreign IDs indistinguishable without side effects", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    expect(
      (await request("/api/contacts", viewer, { method: "POST", body: "{}" }))
        .status,
    ).toBe(403);

    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    const before = database
      .prepare("SELECT * FROM contacts WHERE id='con_0001_northstar'")
      .get();
    expect(
      (await request("/api/contacts/con_0001_northstar", outside)).status,
    ).toBe(404);
    expect(
      (
        await request("/api/contacts/con_0001_northstar", outside, {
          method: "PUT",
          body: "{}",
        })
      ).status,
    ).toBe(404);
    const after = database
      .prepare("SELECT * FROM contacts WHERE id='con_0001_northstar'")
      .get();
    expect(after).toEqual(before);
  });

  it("reports optimistic edit conflicts with the current record", async () => {
    const cookie = await signIn("owner@northstar.test", "OwnerPass!2026");
    const current = await (
      await request("/api/contacts/con_0001_northstar", cookie)
    ).json();
    const response = await request("/api/contacts/con_0001_northstar", cookie, {
      method: "PUT",
      body: JSON.stringify({
        ...current.contact,
        companyId: current.contact.company.id,
        ownerMembershipId: current.contact.owner.id,
        version: 999,
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("EDIT_CONFLICT");
  });
});
