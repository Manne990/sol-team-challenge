import { expect, test } from "@playwright/test";
test("owner creates a member and reviews the append-only audit", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Administration" }).click();
  await expect(
    page.getByRole("heading", { name: "Administration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create member" }).click();
  const dialog = page.getByRole("dialog", { name: "Create member" });
  await dialog.locator('input[name="name"]').fill("Taylor Reed");
  await dialog.locator('input[name="email"]').fill("taylor@northstar.test");
  await dialog.locator('input[name="password"]').fill("Temporary!2026");
  await dialog.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText("Member created")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Taylor Reed" })).toBeVisible();
  await page.getByRole("link", { name: "Audit" }).click();
  await expect(
    page.getByRole("heading", { name: "Audit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "membership.created" }),
  ).toBeVisible();
});
