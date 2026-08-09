import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
async function session(page) {
  await page.route("**/api/auth/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: "user-member",
              membershipId: "mem-member",
              email: "member@northstar.test",
              name: "Morgan Member",
              role: "member",
              organization: { id: "org-northstar", name: "Northstar Demo" },
              sessionExpiresAt: "2026-08-10T08:00:00.000Z",
            },
          }),
        })
      : route.continue(),
  );
}
test("user filters, follows, and marks personal notifications read", async ({
  page,
}) => {
  await session(page);
  let read = false;
  await page.route("**/api/notifications**", async (route) => {
    if (route.request().method() === "PATCH") {
      read = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ notification: {} }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "note-browser",
            type: "task_overdue",
            title: "Task overdue",
            body: "Call Acme was due yesterday.",
            href: "/tasks/task-browser",
            createdAt: "2026-08-09T10:00:00.000Z",
            readAt: read ? "2026-08-09T11:00:00Z" : null,
          },
        ],
        total: 1,
        unread: read ? 0 : 1,
        page: 1,
        pages: 1,
      }),
    });
  });
  await page.goto("/workspace");
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByText("Call Acme was due yesterday.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Task overdue" }),
  ).toHaveAttribute("href", "/tasks/task-browser");
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(page.getByText("0 unread")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
