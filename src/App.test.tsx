import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("shows a connected operational workspace", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(input).includes("/api/dashboard")
            ? {
                generatedAt: "2026-08-05T12:00:00.000Z",
                openPipeline: [],
                closingSoon: [],
                closingSoonHref: "/deals",
                tasks: {
                  overdue: 0,
                  upcoming: 0,
                  overdueHref: "/tasks",
                  upcomingHref: "/tasks",
                },
                staleAccounts: { count: 0, items: [], href: "/companies" },
                stageDistribution: [],
                wonLostTrend: [],
                recentActivity: [],
              }
            : {
                user: {
                  id: "user-owner",
                  membershipId: "member-owner",
                  email: "owner@northstar.test",
                  name: "Northstar Owner",
                  role: "owner",
                  organization: { id: "org-northstar", name: "Northstar Demo" },
                  sessionExpiresAt: "2026-08-10T00:00:00.000Z",
                },
              },
      }),
    ),
  );
  render(<App />);
  expect(screen.getByText(/Loading your workspace/)).toBeTruthy();
  expect(
    await screen.findByRole("heading", { name: "Dashboard" }),
  ).toBeTruthy();
});

test("explains an unavailable server", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: /unavailable/i }),
  ).toBeTruthy();
});
