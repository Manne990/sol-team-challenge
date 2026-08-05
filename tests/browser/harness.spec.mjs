import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("browser harness supports an accessible keyboard sign-in path", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Northstar" })).toBeVisible();
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByLabel("Password").press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Signed in for browser harness verification");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
