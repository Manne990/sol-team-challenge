import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(
  page,
  email = "owner@northstar.test",
  password = "OwnerPass!2026",
) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} CRM is accessible and has no page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const failures = [];
    page.on("console", (message) => {
      if (message.type() === "error")
        failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
    await signIn(page);

    // Hash links are client-side routes, not same-page skip links.
    expect(
      (await new AxeBuilder({ page }).disableRules(["skip-link"]).analyze())
        .violations,
    ).toEqual([]);
    for (const [route, heading] of [
      ["dashboard", "Dashboard"],
      ["companies", "Companies"],
      ["contacts", "Contacts"],
      ["activities", "Activities"],
      ["deals", "Deals"],
      ["tasks", "Tasks"],
      ["imports", "Imports & exports"],
      ["duplicates", "Duplicate review"],
      ["audit", "Audit"],
      ["administration", "Administration"],
    ]) {
      await page.goto(`/#${route}`);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `${route} overflowed at ${viewport.name}`,
      ).toBeLessThanOrEqual(dimensions.clientWidth);
    }
    expect(failures).toEqual([]);
  });
}

test("dashboard recovers from a network failure without an unhandled rejection", async ({
  page,
}) => {
  await signIn(page);
  let failed = false;
  await page.route("**/api/dashboard", async (route) => {
    if (!failed) {
      failed = true;
      await route.abort("internetdisconnected");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this view" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
