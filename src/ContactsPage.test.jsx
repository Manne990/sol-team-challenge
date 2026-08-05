import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactsPage } from "./ContactsPage.jsx";

const contact = {
  id: "contact-1",
  firstName: "Ada",
  lastName: "Lovelace",
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: null,
  jobTitle: "Director",
  status: "active",
  tags: ["vip"],
  communicationPreference: "email",
  company: { id: "company-1", name: "Analytical Engines" },
  owner: { id: "member-1", name: "Avery Owner" },
  createdAt: "2026-08-01T12:00:00Z",
  updatedAt: "2026-08-01T12:00:00Z",
  archivedAt: null,
  version: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "#dashboard");
});

describe("ContactsPage", () => {
  it("renders filtered records and preserves list state in the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          contacts: [contact],
          pagination: { page: 1, pageSize: 25, total: 1, pages: 1 },
        }),
      }),
    );
    render(<ContactsPage role="viewer" />);
    expect(
      await screen.findByRole("button", { name: "Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add contact" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "Ada" },
    });
    await waitFor(() => expect(window.location.hash).toContain("q=Ada"));
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("q=Ada"),
      expect.anything(),
    );
  });

  it("provides all mutable contact fields to members", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          contacts: [],
          pagination: { page: 1, pageSize: 25, total: 0, pages: 1 },
        }),
      }),
    );
    render(<ContactsPage role="member" />);
    fireEvent.click(await screen.findByRole("button", { name: /Add contact/ }));
    expect(
      screen.getByRole("dialog", { name: "Add contact" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "First name *" }),
    ).toBeRequired();
    expect(
      screen.getByRole("combobox", { name: "Communication" }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Add contact" });
    expect(
      within(dialog).getByRole("textbox", { name: "Company ID" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: /Tags/ }),
    ).toBeInTheDocument();
  });
});
