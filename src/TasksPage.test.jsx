import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./TasksPage.jsx";

const task = {
  id: "task-1",
  title: "Prepare renewal briefing",
  description: "Risks",
  assignee: { id: "mem_member", name: "Morgan Member" },
  dueAt: "2026-08-05T22:00:00.000Z",
  priority: "high",
  status: "open",
  company: { id: "company-1", name: "Aster" },
  contact: null,
  deal: null,
  version: 1,
  archivedAt: null,
};
const response = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/tasks");
});

describe("TasksPage", () => {
  it("renders UTC due work and preserves selected due-state views in the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((path) =>
        String(path).includes("assignees")
          ? response({ items: [{ id: "mem_member", name: "Morgan Member" }] })
          : response({
              items: [task],
              page: 1,
              pages: 1,
              total: 1,
              timezone: "UTC",
            }),
      ),
    );
    render(<TasksPage role="member" />);
    expect(
      await screen.findByRole("cell", { name: "2026-08-05 22:00" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));
    await waitFor(() => expect(location.search).toContain("view=overdue"));
    expect(
      screen.getByRole("checkbox", { name: "Assigned to me" }),
    ).toBeTruthy();
  });

  it("lets members complete work with the visible version", async () => {
    const fetchMock = vi.fn((path) => {
      if (String(path).includes("assignees"))
        return response({
          items: [{ id: "mem_member", name: "Morgan Member" }],
        });
      if (String(path).includes("/complete"))
        return response({ task: { ...task, status: "completed", version: 2 } });
      return response({
        items: [task],
        page: 1,
        pages: 1,
        total: 1,
        timezone: "UTC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksPage role="member" />);
    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/task-1/complete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ version: 1 }),
        }),
      ),
    );
    expect(await screen.findByText("Task completed.")).toBeTruthy();
  });

  it("keeps viewer access read-only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        response({
          items: [task],
          page: 1,
          pages: 1,
          total: 1,
          timezone: "UTC",
        }),
      ),
    );
    render(<TasksPage role="viewer" />);
    await screen.findByText("Prepare renewal briefing");
    expect(screen.queryByRole("button", { name: "+ Add task" })).toBeNull();
    expect(screen.getByRole("cell", { name: "Read only" })).toBeTruthy();
  });
});
