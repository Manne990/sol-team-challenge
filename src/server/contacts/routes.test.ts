// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../db/seed.mjs";
import { createApp } from "../app.js";
import { openProductDatabase } from "../database.js";

type Database = ReturnType<typeof openProductDatabase>;
let database: Database;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
  database
    .prepare(
      `INSERT INTO contacts
    (id,organization_id,first_name,last_name,email,status,tags_json,communication_preference,created_at,updated_at)
    VALUES('con_outside','org_outside','Private','Person','private@outside.test','active','[]','email','2026-08-05T12:00:00Z','2026-08-05T12:00:00Z')`,
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

describe("contact API", () => {
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
        ownerMembershipId: "mem_member",
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
          ownerMembershipId: "mem_owner",
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
