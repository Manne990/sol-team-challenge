import { expect, test } from "@playwright/test";

test("signs in with the keyboard, rejects invalid credentials generically, and signs out", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "The email or password is incorrect.",
  );
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: /Morgan Lee owner/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
