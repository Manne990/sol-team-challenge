import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(page) {
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}

const routes = [
  ["/", "Dashboard"],
  ["/companies", "Companies"],
  ["/contacts", "Contacts"],
  ["/activities", "Activities"],
  ["/deals", "Deals"],
  ["/tasks", "Tasks"],
  ["/imports", "Imports & exports"],
  ["/duplicates", "Duplicate review"],
  ["/notifications", "Notifications"],
  ["/audit", "Audit"],
  ["/admin", "Administration"],
];

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} primary routes are accessible, contained, and error-free`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const failures = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
    await signIn(page);
    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const width = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(width.scroll, `${route} overflowed at ${viewport.name}`).toBeLessThanOrEqual(width.client);
      expect((await new AxeBuilder({ page }).analyze()).violations, `${route} axe at ${viewport.name}`).toEqual([]);
    }
    expect(failures).toEqual([]);
  });
}

test("dashboard recovers from a network interruption without an unhandled rejection", async ({ page }) => {
  await signIn(page);
  let failed = false;
  await page.route("**/api/dashboard", async (route) => {
    if (!failed) {
      failed = true;
      await route.abort("internetdisconnected");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(page.getByRole("heading", { name: "We couldn’t load this view" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

test("contact conflict preserves the draft and exposes the latest server version", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts?q=contact1%40example.test");
  await page.getByRole("button", { name: "Contact1 Person1" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
    const firstName = page.getByRole("textbox", {
      name: "First name",
      exact: true,
    });
  await firstName.fill("Draft name");
  await page.evaluate(async () => {
    const current = await fetch("/api/contacts/con_0001_northstar").then((response) => response.json());
    await fetch("/api/contacts/con_0001_northstar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current.contact,
        firstName: "Server",
        companyId: current.contact.company.id,
        ownerMembershipId: current.contact.owner.id,
      }),
    });
  });
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByRole("heading", { name: "Review the latest saved version" })).toBeVisible();
  await expect(firstName).toHaveValue("Draft name");
  await expect(page.getByText(/Latest server value: Server Person1/)).toBeVisible();
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
});
