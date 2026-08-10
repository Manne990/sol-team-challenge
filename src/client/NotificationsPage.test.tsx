// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NotificationsPage } from "./NotificationsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const item = {
  id: "note_1",
  type: "task_overdue",
  title: "Task overdue",
  body: "Call Acme was due yesterday.",
  href: "/tasks/task_1",
  createdAt: "2026-08-09T10:00:00.000Z",
  readAt: null,
};
test("lists personal notifications and marks one read", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [item],
        total: 1,
        unread: 1,
        page: 1,
        pages: 1,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        notification: { ...item, readAt: "2026-08-09T11:00:00Z" },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ ...item, readAt: "2026-08-09T11:00:00Z" }],
        total: 1,
        unread: 0,
        page: 1,
        pages: 1,
      }),
    });
  vi.stubGlobal("fetch", fetchMock);
  render(<NotificationsPage />);
  expect(await screen.findByText("Call Acme was due yesterday.")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Task overdue" }).getAttribute("href"),
  ).toBe("/tasks/task_1");
  fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Mark read" })).toBeNull(),
  );
  expect(fetchMock.mock.calls[1]).toEqual([
    "/api/notifications/note_1/read",
    { method: "PATCH" },
  ]);
});
test("supports empty filters and a deliberate loading state", async () => {
  let resolveResponse: (value: unknown) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    ),
  );
  render(<NotificationsPage />);
  expect(screen.getByText("Loading your notifications…")).toBeTruthy();
  resolveResponse({
    ok: true,
    json: async () => ({ items: [], total: 0, unread: 0, page: 1, pages: 1 }),
  });
  expect(
    await screen.findByRole("heading", { name: "You’re all caught up" }),
  ).toBeTruthy();
});
