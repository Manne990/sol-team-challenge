import { expect, test } from "@playwright/test";

async function signIn(page) {
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("complementary", { name: "Primary navigation" }),
  ).toBeVisible();
}

test("keyboard global search groups results and reaches an authorized record", async ({
  page,
}) => {
  await signIn(page);
  const search = page.getByRole("searchbox", { name: "Search CRM" });
  await search.fill("Opportunity 1");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.getByRole("heading", { name: "deals" })).toBeVisible();
  await results
    .getByRole("link", { name: /Opportunity 1/ })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Opportunity 1" }),
  ).toBeVisible();

  await search.fill("no-match-value");
  await expect(results.getByText("No matching CRM records.")).toBeVisible();
});

test("user saves and reapplies a personal company filter view", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Companies" }).click();
  await page.getByLabel("Lifecycle").selectOption("prospect");
  await expect(page).toHaveURL(/lifecycle=prospect/);
  page.once("dialog", (dialog) => dialog.accept("Prospects"));
  await page.getByRole("button", { name: "Save new" }).click();
  await expect(page.getByLabel("Personal view")).toHaveValue(/.+/);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Lifecycle")).toHaveValue("");
  await page.getByLabel("Personal view").selectOption({ label: "Prospects" });
  await expect(page.getByLabel("Lifecycle")).toHaveValue("prospect");
  await expect(page).toHaveURL(/lifecycle=prospect/);
});
