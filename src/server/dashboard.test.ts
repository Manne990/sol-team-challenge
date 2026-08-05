// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.mjs";
import { createApp } from "./app.js";
import { openProductDatabase } from "./database.js";

const now = () => new Date("2026-08-05T12:00:00.000Z");
let database: ReturnType<typeof openProductDatabase>;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  database = openProductDatabase(":memory:");
  seedDatabase(database);
  server = createServer(createApp(database, { clock: now }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  database.close();
});
async function login(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0];
}
const dashboard = async (cookie: string) => {
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  return { response, body: await response.json() };
};

describe("evidence dashboard", () => {
  it("derives every metric with explicit UTC windows and keeps currencies separate", async () => {
    const { response, body } = await dashboard(
      await login("owner@northstar.test", "OwnerPass!2026"),
    );
    expect(response.status).toBe(200);
    expect(body.generatedAt).toBe("2026-08-05T12:00:00.000Z");
    expect(body.windows).toEqual({
      upcomingDays: 7,
      closingDays: 30,
      staleDays: 30,
      trendDays: 90,
    });
    expect(
      body.openPipeline.map((row: { currency: string }) => row.currency),
    ).toEqual(["SEK", "USD"]);
    expect(
      body.stageDistribution.some((row: { count: number }) => row.count > 0),
    ).toBe(true);
    expect(
      body.wonLostTrend.some((row: { status: string }) => row.status === "won"),
    ).toBe(true);
    expect(body.recentActivity).toHaveLength(8);
    expect(body.tasks.overdue).toBeGreaterThan(0);
    expect(body.tasks.upcoming).toBeGreaterThan(0);
    expect(body.tasks.upcomingHref).toContain(
      "dueBefore=2026-08-12T12%3A00%3A00.000Z",
    );
    expect(body.closingSoonHref).toContain(
      "closeFrom=2026-08-05&closeTo=2026-09-04",
    );
  });

  it("honors exact date boundaries and reconciles linked filtered records", async () => {
    database
      .prepare("UPDATE tasks SET due_at=? WHERE id=?")
      .run("2026-08-05T12:00:00.000Z", "task_0001_northstar");
    const { body } = await dashboard(
      await login("member@northstar.test", "MemberPass!2026"),
    );
    const expectedClosing = Number(
      (
        database
          .prepare(
            `SELECT count(*) count FROM deals WHERE organization_id='org_northstar' AND archived_at IS NULL AND status='open' AND expected_close_date>='2026-08-05' AND expected_close_date<='2026-09-04'`,
          )
          .get() as { count: number }
      ).count,
    );
    expect(
      body.closingSoon.reduce(
        (sum: number, row: { count: number }) => sum + row.count,
        0,
      ),
    ).toBe(expectedClosing);
    const expectedStale = Number(
      (
        database
          .prepare(
            `SELECT count(*) count FROM companies c WHERE organization_id='org_northstar' AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.organization_id=c.organization_id AND a.company_id=c.id AND a.occurred_at>='2026-07-06T12:00:00.000Z')`,
          )
          .get() as { count: number }
      ).count,
    );
    expect(body.staleAccounts.count).toBe(expectedStale);
    expect(body.tasks.upcoming).toBeGreaterThanOrEqual(1);
  });

  it("returns useful zeros for a partial tenant without leaking foreign records", async () => {
    const before = database
      .prepare(
        "SELECT count(*) count FROM deals WHERE organization_id='org_northstar'",
      )
      .get();
    const { response, body } = await dashboard(
      await login("other-owner@outside.test", "OutsidePass!2026"),
    );
    expect(response.status).toBe(200);
    expect(body.openPipeline).toEqual([]);
    expect(body.recentActivity).toEqual([]);
    expect(body.tasks).toMatchObject({ overdue: 0, upcoming: 0 });
    expect(JSON.stringify(body)).not.toContain("Northstar Account");
    expect(
      database
        .prepare(
          "SELECT count(*) count FROM deals WHERE organization_id='org_northstar'",
        )
        .get(),
    ).toEqual(before);
  });
});
