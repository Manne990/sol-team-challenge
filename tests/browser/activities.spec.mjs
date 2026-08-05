import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(page, email, password) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("complementary", { name: "Primary navigation" }),
  ).toBeVisible();
}

test("member records a meeting and transactional follow-up in the real product", async ({
  page,
}) => {
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByRole("link", { name: "Activities" }).click();
  await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
  await page.getByRole("button", { name: "Record activity" }).click();
  await page.getByLabel("Type").selectOption("meeting");
  await page.getByLabel("Subject *").fill("Browser renewal meeting");
  await page.getByLabel("Summary").fill("Agreed to send a revised proposal.");
  await page.getByLabel("Company ID").fill("cmp_0001_northstar");
  await page
    .getByRole("textbox", { name: "Contact ID", exact: true })
    .fill("con_0001_northstar");
  await page
    .getByLabel("Participant contact IDs")
    .fill("con_0001_northstar, con_0002_northstar");
  await page.getByLabel("Create linked follow-up task").check();
  await page.getByLabel("Follow-up title *").fill("Send browser proposal");
  await page.getByRole("button", { name: "Record activity" }).click();
  await expect(page.getByText("Browser renewal meeting")).toBeVisible();
  await expect(
    page
      .locator("article")
      .filter({ hasText: "Browser renewal meeting" })
      .getByRole("link", { name: "Open linked follow-up" }),
  ).toBeVisible();
  const activity = page
    .locator("article")
    .filter({ hasText: "Browser renewal meeting" });
  await activity.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Subject *").fill("Browser renewal meeting revised");
  await page.getByLabel("Summary").fill("Revised proposal was delivered.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Browser renewal meeting revised")).toBeVisible();
  const revised = page
    .locator("article")
    .filter({ hasText: "Browser renewal meeting revised" });
  await revised.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete activity" }).click();
  await expect(page.getByText("Browser renewal meeting revised")).toHaveCount(
    0,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("viewer can read the timeline but cannot record activity", async ({
  page,
}) => {
  await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
  await page.getByRole("link", { name: "Activities" }).click();
  await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record activity" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(
    page.getByText("Historical interaction 1", { exact: true }),
  ).toBeVisible();
});

test("foreign activity relationships are rejected atomically without console errors", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  const before = await page.evaluate(
    async () =>
      (await (await fetch("/api/activities?pageSize=1")).json()).pagination
        .total,
  );
  await page.getByRole("link", { name: "Activities" }).click();
  await page.getByRole("button", { name: "Record activity" }).click();
  await page.getByLabel("Subject *").fill("Referee Foreign Activity Browser");
  await page.getByLabel("Company ID").fill("cmp_outside");
  await page.getByRole("button", { name: "Record activity" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "A related record is unavailable.",
  );
  const after = await page.evaluate(
    async () =>
      (await (await fetch("/api/activities?pageSize=1")).json()).pagination
        .total,
  );
  expect(after).toBe(before);
  expect(failures).toEqual([]);
});
