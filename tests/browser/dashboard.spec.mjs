import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("dashboard metrics reconcile with their filtered work lists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("viewer@northstar.test");
  await page.getByLabel("Password").fill("ViewerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  const evidence = await page.evaluate(() =>
    fetch("/api/dashboard").then((response) => response.json()),
  );
  await expect(page.getByRole("link", { name: /Overdue tasks/ })).toContainText(
    String(evidence.tasks.overdue),
  );
  await expect(page.getByRole("link", { name: /Open pipeline/ })).toContainText(
    `${evidence.openPipeline.reduce((sum, row) => sum + row.count, 0)} deals`,
  );
  await page.getByRole("link", { name: /Overdue tasks/ }).click();
  await expect(page).toHaveURL(/#tasks\?view=overdue/);
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("expired sessions return to a console-clean sign-in state", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Northstar" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(failures).toEqual([]);
});
