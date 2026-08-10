import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("maps, previews, reports partial-row errors, and explicitly commits a CSV", async ({
  page,
}) => {
  await page.goto("/imports");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Imports and exports" }),
  ).toBeVisible();
  await page.getByLabel(/UTF-8 CSV file/).setInputFiles({
    name: "companies.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,organizationNumber\nBrowser Company,BROWSER-1\n,INVALID",
    ),
  });
  await expect(
    page.getByRole("group", { name: "Column mapping" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview and validate" }).click();
  await expect(page.getByRole("status")).toContainText(
    "1 valid · 1 with errors",
  );
  await expect(page.getByText("Company name is required.")).toBeVisible();
  await page.getByRole("button", { name: "Commit 1 valid row" }).click();
  await expect(
    page.getByRole("button", { name: "Import committed" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Export companies" }),
  ).toHaveAttribute("href", "/api/imports/exports/companies.csv");
});
