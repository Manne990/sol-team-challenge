import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AuditPage } from "./AuditPage";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("hides audit from non-owners", () => {
  render(<AuditPage role="viewer" />);
  expect(
    screen.getByRole("heading", { name: "Access restricted" }),
  ).toBeTruthy();
});
test("renders actor, correlation, and safe summary", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "audit-1",
              actor: {
                id: "mem",
                name: "Avery Owner",
                email: "owner@northstar.test",
              },
              action: "company.updated",
              entityType: "company",
              entityId: "cmp-1",
              correlationId: "corr-1",
              summary: { changed: ["name"] },
              createdAt: "2026-08-09T10:00:00Z",
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          pages: 1,
        }),
      }),
    ),
  );
  render(<AuditPage role="owner" />);
  expect(await screen.findByText("company.updated")).toBeTruthy();
  expect(screen.getByText("corr-1")).toBeTruthy();
  expect(screen.getByText('{"changed":["name"]}')).toBeTruthy();
});
