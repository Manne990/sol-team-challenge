import { expect, test } from "@playwright/test";
test("keyboard search groups records and saves a personal list view", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  const search = page.getByPlaceholder("Company, contact, deal or task");
  await search.fill("Acme");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "4 search results" }),
  ).toContainText("Acme Nordic AB");
  await page.getByRole("button", { name: "Save this search" }).click();
  await page.getByLabel("View name").fill("Acme records");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByText("View saved")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Acme records companies" }),
  ).toBeVisible();
});
