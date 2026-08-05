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
test("owner updates safe settings and manages access with auditable consequences", async ({
  page,
}) => {
  await signIn(page, "owner@northstar.test", "OwnerPass!2026");
  await page.getByRole("link", { name: "Administration" }).click();
  await expect(
    page.getByRole("heading", { name: "Administration" }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Northstar Browser Team");
  await page.getByLabel("Timezone").fill("Europe/Stockholm");
  await page.getByLabel("Locale").fill("sv-SE");
  await page.getByLabel("Currency").fill("SEK");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Northstar Browser Team",
  );
  await page.getByLabel("Email").fill("browser-admin@northstar.test");
  await page.getByLabel("First name").fill("Browser");
  await page.getByLabel("Last name").fill("Admin");
  await page.getByLabel("Temporary password").fill("BrowserPass!2026");
  await page.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText("browser-admin@northstar.test")).toBeVisible();
  await page.getByLabel("Role for Browser Admin").selectOption("viewer");
  await expect(page.getByLabel("Role for Browser Admin")).toHaveValue("viewer");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByText("browser-admin@northstar.test")
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Revoke access" })
    .click();
  await expect(page.getByText("browser-admin@northstar.test")).toHaveCount(0);
  await page.getByRole("link", { name: "Audit" }).click();
  await page.getByLabel("Action").fill("organization.updated");
  await expect(
    page.getByRole("cell", { name: "organization.updated" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("non-owner cannot discover governance APIs", async ({ page }) => {
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(
    0,
  );
  const statuses = await page.evaluate(async () =>
    Promise.all(
      [
        "/api/governance/organization",
        "/api/governance/audit",
        "/api/auth/members",
      ].map(async (url) => (await fetch(url)).status),
    ),
  );
  expect(statuses).toEqual([403, 403, 403]);
});

test("member administration restriction is a console-clean UI outcome", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.goto("/#administration");
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this view" }),
  ).toBeVisible();
  await expect(
    page.getByText("You do not have permission to do that"),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
