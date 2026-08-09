// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import { createApp } from "./app.js";
import { openProductDatabase } from "./database.js";

type Database = ReturnType<typeof openProductDatabase>;
let database: Database, server: Server, baseUrl: string;
beforeEach(async () => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
  server = createServer(createApp(database));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
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
  if (!cookie) throw new Error("cookie missing");
  return cookie;
}
const call = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init.headers },
  });

describe("global discovery", () => {
  it("groups stable organization-scoped search results without foreign snippets", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const response = await call("/api/search?q=Northstar", owner);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body.groups)).toEqual([
      "companies",
      "contacts",
      "deals",
      "tasks",
    ]);
    expect(body.groups.companies).toHaveLength(5);
    expect(
      body.groups.companies[0].name.localeCompare(
        body.groups.companies[1].name,
        undefined,
        { sensitivity: "base" },
      ),
    ).toBeLessThanOrEqual(0);
    expect(JSON.stringify(body)).not.toContain("Outside Secret");
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    expect(
      JSON.stringify(
        await (await call("/api/search?q=Northstar", outside)).json(),
      ),
    ).not.toContain("Northstar Account");
  });

  it("creates, lists, chooses, renames, updates, and deletes personal views", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const createdResponse = await call("/api/views", owner, {
      method: "POST",
      body: JSON.stringify({
        resource: "companies",
        name: "Priority accounts",
        definition: {
          lifecycle: "customer",
          tag: "priority",
          sort: "updated_at",
        },
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).view;
    const list = await (
      await call("/api/views?resource=companies", owner)
    ).json();
    expect(list.views).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Priority accounts",
        definition: {
          lifecycle: "customer",
          tag: "priority",
          sort: "updated_at",
        },
      }),
    ]);
    const updatedResponse = await call(`/api/views/${created.id}`, owner, {
      method: "PUT",
      body: JSON.stringify({
        name: "Renewal accounts",
        definition: { lifecycle: "customer", tag: "renewal" },
        version: 1,
      }),
    });
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).view.version).toBe(2);
    expect(
      (
        await call(`/api/views/${created.id}`, owner, {
          method: "PUT",
          body: JSON.stringify({ name: "Stale", definition: {}, version: 1 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(`/api/views/${created.id}`, owner, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect(
      (await (await call("/api/views?resource=companies", owner)).json()).views,
    ).toEqual([]);
  });

  it("keeps saved view identity private across users and organizations", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const created = (
      await (
        await call("/api/views", owner, {
          method: "POST",
          body: JSON.stringify({
            resource: "tasks",
            name: "Mine",
            definition: { assignedToMe: "true" },
          }),
        })
      ).json()
    ).view;
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    expect(
      (await (await call("/api/views?resource=tasks", viewer)).json()).views,
    ).toEqual([]);
    expect(
      (await call(`/api/views/${created.id}`, viewer, { method: "DELETE" }))
        .status,
    ).toBe(404);
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    expect(
      (await call(`/api/views/${created.id}`, outside, { method: "DELETE" }))
        .status,
    ).toBe(404);
    expect(
      database.prepare("SELECT 1 FROM saved_views WHERE id=?").get(created.id),
    ).toBeTruthy();
  });

  it("rejects short searches and stale or malformed view definitions safely", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    expect((await call("/api/search?q=x", owner)).status).toBe(400);
    expect(
      (
        await call("/api/views", owner, {
          method: "POST",
          body: JSON.stringify({
            resource: "unknown",
            name: "Bad",
            definition: [],
          }),
        })
      ).status,
    ).toBe(400);
  });
});
