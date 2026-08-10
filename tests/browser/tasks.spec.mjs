import { expect, test } from "@playwright/test";
test("owner creates and completes UTC follow-up work", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByText("Review proposal")).toBeVisible();
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByLabel("Title").fill("Send renewal brief");
  await page.getByLabel("Due date and time").fill("2026-08-12T09:00");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();
  await expect(page.getByText("Send renewal brief")).toBeVisible();
  await page
    .getByRole("row", { name: /Review proposal/ })
    .getByRole("button", { name: "Complete" })
    .click();
  await expect(page.getByText("Task completed")).toBeVisible();
});
