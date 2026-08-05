import { expect, test } from "@playwright/test";

async function signIn(page, email, password) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("member maps, previews, and explicitly commits valid CSV rows", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Imports" }).click();
  await expect(
    page.getByRole("heading", { name: "Imports & exports" }),
  ).toBeVisible();
  await page.getByLabel("UTF-8 CSV file").setInputFiles({
    name: "companies.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,organizationNumber,description\r\nBrowser CSV Co,BROWSER-CSV,Imported safely\r\nUnsafe Row,BAD-FORMULA,=cmd\r\n",
    ),
  });
  await expect(
    page.getByRole("heading", { name: "Map columns" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview rows" }).click();
  await expect(page.getByText("valid", { exact: true })).toBeVisible();
  await expect(page.getByText("invalid", { exact: true })).toBeVisible();
  await expect(page.getByText(/spreadsheet formula character/)).toBeVisible();
  await page.getByRole("button", { name: "Commit valid rows" }).click();
  await expect(
    page.getByRole("heading", { name: "Import committed" }),
  ).toBeVisible();
  await expect(page.getByText(/1 rows committed/)).toBeVisible();
  await page.getByRole("link", { name: "Companies", exact: true }).click();
  await page.getByLabel("Search").fill("Browser CSV Co");
  await expect(
    page.getByRole("link", { name: "Browser CSV Co" }),
  ).toBeVisible();
});

test("viewer can export but sees a deliberate read-only import state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("viewer@northstar.test");
  await page.getByLabel("Password").fill("ViewerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Imports" }).click();
  await expect(
    page.getByRole("link", { name: "Export companies" }),
  ).toHaveAttribute("href", "/api/imports/export/companies");
  await expect(
    page.getByRole("heading", { name: "Import is read-only for viewers" }),
  ).toBeVisible();
});

test("exports preserve active company and contact list filters", async ({
  page,
}) => {
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByRole("link", { name: "Companies" }).click();
  await page.getByLabel("Lifecycle").selectOption("customer");
  await page.getByRole("link", { name: "Contacts" }).click();
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("link", { name: "Imports" }).click();
  await expect(
    page.getByRole("link", { name: "Export companies" }),
  ).toHaveAttribute("href", "/api/imports/export/companies?lifecycle=customer");
  await expect(
    page.getByRole("link", { name: "Export contacts" }),
  ).toHaveAttribute("href", "/api/imports/export/contacts?status=active");
});
