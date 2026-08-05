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

test("member creates, reads, archives, and restores a complete company", async ({
  page,
}) => {
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByLabel("Name *").fill("Aardvark Browser AB");
  await page.getByLabel("Organization number").fill("BROWSER-100");
  await page.getByLabel("External reference").fill("PW-100");
  await page.getByLabel("Website").fill("https://aardvark.example.test");
  await page.getByLabel("Phone").fill("+46 8 100 200");
  await page.getByLabel("Industry").fill("Technology");
  await page.getByLabel("Size").selectOption("medium");
  await page.getByLabel("Lifecycle").selectOption("prospect");
  await page.getByLabel("Address").fill("Stockholm, Sweden");
  await page.getByLabel("Tags, comma separated").fill("priority, browser");
  await page
    .getByLabel("Description")
    .fill("Created by the real browser workflow.");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.getByRole("link", { name: "Aardvark Browser AB" }).click();
  await expect(page.getByText("BROWSER-100")).toBeVisible();
  await expect(
    page.getByText("Created by the real browser workflow."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "contacts, activities, deals, tasks, and history remain intact",
  );
  await page.getByRole("button", { name: "Archive company" }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Restore company" }).click();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("cross-tenant company owner validation is console-clean and atomic", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByRole("link", { name: "Companies" }).click();
  const before = await page.evaluate(
    async () => (await (await fetch("/api/companies?pageSize=1")).json()).total,
  );
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByLabel("Name *").fill("Referee Invalid Owner Browser");
  await page.getByLabel("Owner membership ID").fill("mem_outside");
  await page.getByRole("button", { name: "Save company" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose an active owner in your organization.",
  );
  const after = await page.evaluate(
    async () => (await (await fetch("/api/companies?pageSize=1")).json()).total,
  );
  expect(after).toBe(before);
  expect(failures).toEqual([]);
});

test("viewer can scan companies but cannot mutate or discover a foreign id", async ({
  page,
}) => {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add company" })).toHaveCount(
    0,
  );
  await page.goto("/#companies/cmp_0001_outside");
  await expect(
    page.getByRole("heading", { name: "Record not found" }),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
