import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("member receives one replay-safe assignment notification and controls personal read state", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title *").fill("Notification browser follow-up");
  await dialog.getByLabel("Assignee *").selectOption("mem_member");
  await dialog.getByLabel("Priority").selectOption("normal");
  await dialog.getByRole("button", { name: "Save task" }).click();
  const trigger = page.getByRole("button", { name: /Notifications/ });
  await trigger.click();
  const panel = page.getByRole("region", { name: "Notifications panel" });
  await expect(panel.getByText("Task assigned to you", { exact: true })).toHaveCount(1);
  await panel.getByRole("button", { name: /Task assigned to you Notification browser follow-up/ }).click();
  await expect(page).toHaveURL(/#tasks\?q=Notification%20browser%20follow-up/);
  await trigger.click();
  await panel.getByRole("button", { name: "Unread" }).click();
  await panel.getByRole("button", { name: "Mark all read" }).click();
  await expect(trigger).toHaveAttribute("aria-label", "Notifications");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
