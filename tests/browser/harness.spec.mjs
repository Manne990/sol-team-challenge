import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("owner creates, reviews, and archives a contact", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("36 contacts")).toBeVisible();
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Last name *").fill("Evidence");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Tags").fill("browser, acceptance");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("dialog", { name: "Browser Evidence" }),
  ).toBeVisible();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive contact" }).click();
  await expect(page.getByText("Contact archived.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
