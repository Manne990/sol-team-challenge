import { expect, test } from "@playwright/test";
test("reviewer sees normalized evidence, resolves fields, and explicitly merges", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Companies", exact: true }).click();
  await page.getByRole("button", { name: "New company" }).click();
  await page.getByLabel("Name *").fill("Northstar Account 1 AB");
  await page.getByLabel("Organization number").fill("MERGE-BROWSER");
  await page.getByLabel("Phone").fill("+46 8 555 0001");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.getByRole("link", { name: "Duplicates" }).click();
  await expect(page.getByText(/name: northstar account 1/)).toBeVisible();
  const candidates = await page.evaluate(() =>
    fetch("/api/duplicates/companies").then((r) => r.json()),
  );
  const candidate = candidates.candidates.find(
    (item) =>
      item.left.label.includes("Northstar Account 1") &&
      item.right.label.includes("Northstar Account 1"),
  );
  expect(candidate).toBeTruthy();
  const survivor =
      candidate.left.label === "Northstar Account 1"
        ? candidate.left
        : candidate.right,
    retired =
      survivor.id === candidate.left.id ? candidate.right : candidate.left;
  await page
    .getByRole("button", { name: `Keep ${survivor.label}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Keep ${survivor.label}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Merge and retire duplicate" })
    .click();
  await expect(
    page.getByRole("heading", { name: "No duplicate suggestions" }),
  ).toBeVisible();
  const resolved = await page.evaluate(
    (id) => fetch(`/api/companies/${id}`).then((r) => r.json()),
    retired.id,
  );
  expect(resolved.redirectedFrom).toBe(retired.id);
  expect(resolved.company.id).toBe(survivor.id);
});
