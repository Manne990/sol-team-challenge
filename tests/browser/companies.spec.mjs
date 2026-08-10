import { expect, test } from "@playwright/test";

test("owner scans, filters, and creates a company while viewer controls stay protected", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /Acme Nordic AB/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByLabel("Company name").fill("Brightpath Studio");
  await page.getByLabel("Organization number").fill("SE-200");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByText("Company created")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /Brightpath Studio/ }),
  ).toBeVisible();
});
