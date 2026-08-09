import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function session(page, role = "owner") {
  await page.route("**/api/auth/session", async (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: `user-${role}`,
              membershipId: `membership-${role}`,
              email: `${role}@northstar.test`,
              name: "Northstar Owner",
              role,
              organization: { id: "org-northstar", name: "Northstar Demo" },
              sessionExpiresAt: "2026-08-10T08:00:00.000Z",
            },
          }),
        })
      : route.continue(),
  );
}

test("member maps, previews, and explicitly commits a CSV", async ({
  page,
}) => {
  await session(page, "member");
  await page.route("**/api/imports/preview", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        importId: "imp-browser",
        status: "preview",
        summary: {
          total: 2,
          valid: 1,
          warnings: 0,
          invalid: 1,
          commitPolicy: "Valid rows commit; invalid rows remain reported.",
        },
        rows: [
          {
            rowNumber: 2,
            status: "valid",
            normalized: { name: "Acme" },
            errors: [],
            warnings: [],
          },
          {
            rowNumber: 3,
            status: "invalid",
            normalized: { name: null },
            errors: ["Company name is required."],
            warnings: [],
          },
        ],
      }),
    }),
  );
  await page.route("**/api/imports/imp-browser/commit", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ summary: { committed: 1, invalid: 1 } }),
    }),
  );
  await page.goto("/workspace");
  await page.getByRole("link", { name: "Imports" }).click();
  await expect(
    page.getByRole("heading", { name: "Imports & exports" }),
  ).toBeVisible();
  await page
    .getByLabel("UTF-8 CSV file")
    .setInputFiles({
      name: "companies.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,organizationNumber\nAcme,AC-1\n,AC-2"),
    });
  await expect(page.getByLabel("Name *")).toHaveValue("name");
  await page.getByRole("button", { name: "Preview and validate" }).click();
  await expect(page.getByText("Company name is required.")).toBeVisible();
  await page.getByRole("button", { name: "Commit 1 rows" }).click();
  await expect(page.getByRole("status")).toContainText("1 rows committed");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("viewer sees exports without import mutation controls", async ({
  page,
}) => {
  await session(page, "viewer");
  await page.goto("/workspace");
  await page.getByRole("link", { name: "Imports" }).click();
  await expect(
    page.getByRole("heading", { name: "Access restricted" }),
  ).toBeVisible();
  await expect(page.getByLabel("UTF-8 CSV file")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Export contacts" }),
  ).toBeVisible();
});
