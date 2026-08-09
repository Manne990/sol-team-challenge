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

test("member creates, scans, moves, loses, and reopens a deal without drag", async ({
  page,
}) => {
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await page.getByRole("button", { name: "Add deal" }).click();
  await page.getByLabel("Deal name *").fill("Browser Expansion 2027");
  await page.getByLabel("Company ID *").fill("cmp_0001_northstar");
  await page.getByLabel("Owner membership ID *").fill("mem_member");
  await page.getByLabel("Stage *").selectOption("stage_qualified");
  await page.getByLabel("Amount *").fill("1250.50");
  await page.getByLabel("Currency *").fill("SEK");
  await page.getByLabel("Expected close date").fill("2027-01-15");
  await page.getByLabel("Probability %").fill("65");
  await page
    .getByLabel("Contact IDs, comma separated")
    .fill("con_0001_northstar");
  await page.getByRole("button", { name: "Save deal" }).click();
  await page.getByRole("link", { name: "Browser Expansion 2027" }).click();
  await expect(page.getByText("65% probability")).toBeVisible();
  await page.getByRole("button", { name: "Move deal" }).click();
  await page.getByLabel("Destination stage").selectOption("stage_lost");
  await page.getByLabel("Loss reason").fill("Budget deferred");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move deal" })
    .click();
  await expect(page.getByText("Budget deferred")).toBeVisible();
  await page.getByRole("button", { name: "Move deal" }).click();
  await page.getByLabel("Destination stage").selectOption("stage_qualified");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move deal" })
    .click();
  await expect(page.getByText(/open · 65% probability/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Stage history" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("viewer sees list and pipeline but no deal mutation controls or foreign detail", async ({
  page,
}) => {
  await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add deal" })).toHaveCount(0);
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("region", { name: "Deals table" })).toBeVisible();
  await page.goto("/deals/deal_outside");
  await expect(
    page.getByRole("heading", { name: "Record not found" }),
  ).toBeVisible();
});
