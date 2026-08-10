import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("actual CRM routes remain accessible, contained, and free of runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ["/workspace", "Dashboard"],
    ["/companies", "Companies"],
    ["/contacts", "Contacts"],
    ["/activities", "Activities"],
    ["/deals", "Deals"],
    ["/tasks", "Tasks"],
    ["/imports", "Imports and exports"],
    ["/notifications", "Notifications"],
    ["/admin", "Administration"],
    ["/audit", "Audit"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll, `${path} page overflow`).toBeLessThanOrEqual(
      width.client,
    );
    expect(
      (await new AxeBuilder({ page }).analyze()).violations,
      `${path} accessibility`,
    ).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("dialogs trap focus, restore focus, and require confirmation for destructive actions", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/companies/fixture-company");
  const archive = page.getByRole("button", { name: "Archive" });
  await archive.click();
  const companyDialog = page.getByRole("dialog", {
    name: "Archive Acme Nordic AB?",
  });
  await expect(companyDialog).toBeVisible();
  await expect(
    companyDialog.getByText(/contacts.*deals.*tasks.*historical activities/u),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(companyDialog).toBeHidden();
  await expect(archive).toBeFocused();

  await page.goto("/admin");
  const revoke = page
    .getByRole("row")
    .filter({ hasText: "Jamie Chen" })
    .getByRole("button", { name: "Revoke" });
  await revoke.click();
  const revokeDialog = page.getByRole("dialog", { name: "Revoke Jamie Chen?" });
  await expect(revokeDialog).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(revokeDialog).toContainText("revokes every active session");
  await page.keyboard.press("Escape");
  await expect(revoke).toBeFocused();
});

test("concurrent edits preserve entered work and failed loads recover by retry", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/companies/fixture-company", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "EDIT_CONFLICT",
            message:
              "This company changed since you opened it. Refresh and compare before saving.",
          },
        }),
      });
    else await route.fallback();
  });
  await page.goto("/companies/fixture-company");
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit company" });
  await edit.getByLabel("Company name").fill("Acme user draft");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/changed since you opened it/u)).toBeVisible();
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel("Company name")).toHaveValue("Acme user draft");

  await page.unroute("**/api/companies/fixture-company");
  let fail = true;
  await page.route("**/api/companies?**", async (route) => {
    if (fail) await route.abort("connectionfailed");
    else await route.fallback();
  });
  await page.goto("/companies");
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Companies", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Acme Nordic AB" }),
  ).toBeVisible();
});
