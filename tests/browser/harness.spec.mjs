import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("invalid credentials remain an expected console-clean form outcome", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("missing@example.test");
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Email or password is incorrect.",
  );
  expect(failures).toEqual([]);
});

test("owner creates and archives a contact through the accessible CRM", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to Northstar" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByLabel("Password").press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Contacts" }).click();
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("36 contacts")).toBeVisible();
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Last name *").fill("Evidence");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser.evidence@example.test");
  await page.getByLabel("Tags").fill("browser, acceptance");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Evidence" }),
  ).toBeVisible();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(
    page.getByRole("dialog", { name: "Archive contact?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive contact" }).click();
  await expect(page.getByText("Contact archived.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
