import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.jsx";

const evidence = {
  generatedAt: "2026-08-05T12:00:00.000Z",
  openPipeline: [{ currency: "SEK", amountMinor: 100000, count: 2 }],
  closingSoon: [{ currency: "SEK", amountMinor: 50000, count: 1 }],
  closingSoonHref: "#deals?status=open&closeFrom=2026-08-05&closeTo=2026-09-04",
  tasks: {
    overdue: 3,
    upcoming: 4,
    overdueHref: "#tasks?view=overdue",
    upcomingHref: "#tasks?view=upcoming",
  },
  staleAccounts: {
    count: 1,
    href: "#companies?lastActivityBefore=cutoff",
    items: [{ id: "company-1", name: "Quiet Co", lastActivityAt: null }],
  },
  stageDistribution: [
    {
      stageId: "stage-1",
      name: "Qualified",
      color: "#123456",
      currency: "SEK",
      count: 2,
      amountMinor: 100000,
      href: "#deals?status=open&stageId=stage-1",
    },
  ],
  wonLostTrend: [],
  recentActivity: [
    {
      id: "activity-1",
      subject: "Discovery call",
      type: "call",
      occurredAt: "2026-08-05T10:00:00Z",
      companyName: "Quiet Co",
      contactName: null,
      href: "#activities",
    },
  ],
};
afterEach(() => vi.restoreAllMocks());

describe("DashboardPage", () => {
  it("renders evidence and links every headline to its exact filtered records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => evidence }),
    );
    render(<DashboardPage />);
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Overdue tasks/ })).toHaveAttribute(
      "href",
      "#tasks?view=overdue",
    );
    expect(
      screen.getByRole("link", { name: /Closing in 30 days/ }),
    ).toHaveAttribute("href", evidence.closingSoonHref);
    expect(
      screen.getByRole("link", { name: /Stale accounts/ }),
    ).toHaveAttribute("href", evidence.staleAccounts.href);
    expect(screen.getByText(/currencies remain separate/i)).toBeInTheDocument();
  });

  it("refreshes predictably without accumulating prior metrics", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => evidence })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...evidence,
          tasks: { ...evidence.tasks, overdue: 1 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardPage />);
    await screen.findByText("3", { selector: "strong" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh metrics" }));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Overdue tasks/ }),
      ).toHaveTextContent("1"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
