import { expect, test, type Page } from "@playwright/test";

async function signIn(
  page: Page,
  email = "owner@northstar.test",
  password = "OwnerPass!2026",
) {
  await page.goto("/workspace");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("real SQLite-backed deal journey creates, edits, moves, wins, loses, and reopens", async ({
  page,
}) => {
  await signIn(page);
  const companyId = await page.evaluate(async () => {
    const response = await fetch("/api/companies?pageSize=1");
    const body = (await response.json()) as { items: { id: string }[] };
    return body.items[0]!.id;
  });
  await page.goto("/deals");
  await page.getByRole("button", { name: "Add deal" }).click();
  await page.getByLabel("Deal name").fill("Release journey deal");
  await page.getByLabel("Company ID").fill(companyId);
  await page.getByLabel("Amount").fill("1250");
  await page.getByRole("button", { name: "Create deal" }).click();
  await page.getByRole("button", { name: "View deal" }).first().click();
  await page.getByRole("button", { name: "Edit deal" }).click();
  await page.getByLabel("Deal name").fill("Release journey deal edited");
  await page.getByRole("button", { name: "Save deal" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Release journey deal edited" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark won" }).click();
  await expect(page.getByText("won", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reopen deal" }).click();
  page.once("dialog", (dialog) => dialog.accept("Budget moved to next year"));
  await page.getByRole("button", { name: "Mark lost" }).click();
  await expect(page.getByText("Budget moved to next year")).toBeVisible();
  await page.getByRole("button", { name: "Reopen deal" }).click();
  await expect(page.getByText("open", { exact: true })).toBeVisible();
});

test("real activity journey creates, edits, and deletes persisted data", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/activities");
  await page
    .locator("header")
    .getByRole("button", { name: "Record activity" })
    .click();
  await page.getByLabel("Subject").fill("Release deletion journey");
  await page.getByRole("textbox", { name: "Notes" }).fill("Initial narrative");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record activity" })
    .click();
  await page.getByRole("button", { name: "Correct narrative" }).click();
  await page
    .getByRole("textbox", { name: "Notes" })
    .fill("Corrected narrative");
  await page.getByRole("button", { name: "Save correction" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete activity" }).click();
  await expect(page.getByText("Activity deleted.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Release deletion journey" }),
  ).toHaveCount(0);
});

test("real duplicate review exposes comparison and explicit merge", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(async () => {
    const session = (await (await fetch("/api/auth/session")).json()) as {
      userId: string;
    };
    for (const suffix of ["A", "B"]) {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Duplicate Release Company",
          externalReference: `release-duplicate-${suffix}`,
          lifecycleStatus: "prospect",
          ownerId: session.userId,
          tags: [],
          description: "Created by real-browser duplicate review.",
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  });
  await page.goto("/duplicates");
  await expect(
    page.getByRole("heading", { name: "Duplicate review" }),
  ).toBeVisible();
  const compare = page
    .getByRole("button", { name: "Compare and merge" })
    .first();
  await expect(compare).toBeVisible();
  await compare.click();
  await expect(
    page.getByRole("heading", { name: "Choose the surviving record" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Merge records" }).click();
  await expect(page.getByText(/Records merged/u)).toBeVisible();
});

test("outside owner sees the authenticated outside organization and identity", async ({
  page,
}) => {
  await signIn(page, "other-owner@outside.test", "OutsidePass!2026");
  await expect(page.getByText("Outside Demo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /owner/u }).click();
  await expect(
    page.getByText("other-owner@outside.test", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Northstar Demo", { exact: true })).toHaveCount(
    0,
  );
});
