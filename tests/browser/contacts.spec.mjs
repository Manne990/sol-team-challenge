/* global document */
import { expect, test } from "@playwright/test";

test("owner can scan contacts and open retained relationship detail", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto("/contacts");

  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add contact" })).toBeVisible();
  await expect(page.getByText("Acme Nordic AB")).toBeVisible();
  await page.getByRole("button", { name: "Avery Stone" }).click();
  await expect(page.getByRole("dialog")).toContainText("Shared history");

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});
