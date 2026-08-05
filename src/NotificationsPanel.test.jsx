import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPanel } from "./NotificationsPanel.jsx";

const note = { id: "n1", title: "Task overdue", body: "Call customer", type: "task_overdue", createdAt: "2026-08-05T20:00:00Z", readAt: null, href: "#tasks?q=Call%20customer" };
const response = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); location.hash = ""; });

describe("NotificationsPanel", () => {
  it("announces unread count and navigates after marking one notification read", async () => {
    const fetchMock = vi.fn((path) => String(path).includes("/read") ? response({ notification: { ...note, readAt: "2026-08-05T20:01:00Z" } }) : response({ items: [note], unread: 1, total: 1, page: 1, pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPanel />);
    const trigger = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: /Task overdue/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications/n1/read", expect.objectContaining({ method: "POST" })));
    expect(location.hash).toContain("tasks?q=Call%20customer");
  });

  it("supports unread filtering, mark-all, empty, and failure states", async () => {
    const fetchMock = vi.fn((path) => String(path).includes("read-all") ? response({ updated: 1 }) : response({ items: [], unread: 1, total: 0, page: 1, pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications?unread=true", expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(await screen.findByText("No notifications here.")).toBeVisible();
  });
});
