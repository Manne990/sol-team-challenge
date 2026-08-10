import { expect, test } from "@playwright/test";

test("owner scans the pipeline, creates a deal, and has a non-drag stage control", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Deals" }).click();
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Acme expansion" }),
  ).toBeVisible();
  await expect(page.getByLabel("Move Acme expansion")).toBeVisible();
  await page.getByRole("button", { name: "Add deal" }).click();
  await page.getByLabel("Deal name").fill("Renewal 2027");
  await page.getByLabel("Company ID").fill("fixture-company");
  await page.getByLabel("Amount").fill("12000");
  await page.getByRole("button", { name: "Create deal" }).click();
  await expect(page.getByText("Deal created")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Renewal 2027" }),
  ).toBeVisible();
});
