/* global document */
import { expect, test } from "@playwright/test";

test("member scans the timeline and records every required activity field", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto("/activities");
  await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Renewal call" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record activity" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox")
    .first()
    .selectOption("meeting");
  await page.getByLabel("Subject").fill("Implementation review");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Reviewed the implementation plan and next steps.");
  await page.getByRole("button", { name: "Record activity" }).last().click();
  await expect(page.getByRole("dialog")).toContainText("Implementation review");
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});
