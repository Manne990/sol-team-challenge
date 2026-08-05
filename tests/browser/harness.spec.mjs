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

test("stale contact edits preserve the draft without console errors", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Contacts" }).click();
  await page
    .getByRole("button", { name: "Contact1 Person1", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Job title").fill("My preserved draft");
  const externalStatus = await page.evaluate(async () => {
    const current = (
      await (await fetch("/api/contacts/con_0001_northstar")).json()
    ).contact;
    const response = await fetch("/api/contacts/con_0001_northstar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        companyId: current.company?.id || null,
        ownerMembershipId: current.owner?.id || null,
        jobTitle: "Externally saved title",
      }),
    });
    return response.status;
  });
  expect(externalStatus).toBe(200);
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the latest saved version" }),
  ).toBeVisible();
  await expect(page.getByLabel("Job title")).toHaveValue("My preserved draft");
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
