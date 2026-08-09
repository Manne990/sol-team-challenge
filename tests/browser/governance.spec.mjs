import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
async function session(page, role = "owner") {
  await page.route("**/api/auth/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: `user-${role}`,
              membershipId: `mem-${role}`,
              email: `${role}@northstar.test`,
              name: "Avery Owner",
              role,
              organization: { id: "org", name: "Northstar Demo" },
              sessionExpiresAt: "2026-08-10T00:00:00Z",
            },
          }),
        })
      : route.continue(),
  );
}
test("owner manages safe organization settings and reviews audit evidence", async ({
  page,
}) => {
  await session(page);
  await page.route("**/api/auth/members**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        members: [
          {
            id: "mem-owner",
            name: "Avery Owner",
            email: "owner@northstar.test",
            role: "owner",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/governance/organization", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        organization: {
          id: "org",
          name: "Northstar Demo",
          settings: {
            currency: "SEK",
            timezone: "Europe/Stockholm",
            staleAccountDays: 30,
          },
          updatedAt: "2026-08-09T00:00:00Z",
          version: 1,
        },
      }),
    }),
  );
  await page.route("**/api/governance/audit**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "audit-1",
            actor: {
              id: "mem-owner",
              name: "Avery Owner",
              email: "owner@northstar.test",
            },
            action: "organization.updated",
            entityType: "organization",
            entityId: "org",
            correlationId: "corr-browser",
            summary: { currency: "SEK" },
            createdAt: "2026-08-09T10:00:00Z",
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
        pages: 1,
      }),
    }),
  );
  await page.goto("/workspace");
  await page.getByRole("link", { name: "Administration" }).click();
  await expect(
    page.getByRole("heading", { name: "Administration" }),
  ).toBeVisible();
  await expect(page.getByLabel("Temporary password")).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("link", { name: "Audit" }).click();
  await expect(page.getByText("organization.updated")).toBeVisible();
  await expect(page.getByText("corr-browser")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("member cannot discover owner governance navigation or guessed surfaces", async ({
  page,
}) => {
  await session(page, "member");
  await page.goto("/workspace");
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(
    0,
  );
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Access restricted" }),
  ).toBeVisible();
});
