import { expect, test } from "@playwright/test";

test("dashboard metrics reconcile to filtered operational routes", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.locator('a.ns-metric[href="/deals?status=open"]'),
  ).toContainText("25,000");
  await expect(
    page.getByRole("link", { name: /Overdue work 1/ }),
  ).toHaveAttribute("href", "/tasks?view=overdue");
  await expect(
    page.getByRole("heading", { name: "Pipeline by stage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Discovery call" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Closing soon 1/ }).click();
  await expect.poll(() => page.url()).toContain("closeTo=2026-09-09");
});
