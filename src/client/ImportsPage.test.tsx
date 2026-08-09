import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ImportsPage } from "./ImportsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("viewers receive a deliberate import restriction and authorized exports", () => {
  render(<ImportsPage role="viewer" />);
  expect(
    screen.getByRole("heading", { name: "Access restricted" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Export companies" }).getAttribute("href"),
  ).toBe("/api/imports/export/companies.csv");
});

test("maps a CSV, previews row outcomes, and explicitly commits", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        importId: "imp_1",
        status: "preview",
        summary: {
          total: 2,
          valid: 1,
          warnings: 0,
          invalid: 1,
          commitPolicy: "Valid rows commit; invalid rows remain reported.",
        },
        rows: [
          {
            rowNumber: 2,
            status: "valid",
            normalized: { name: "Acme" },
            errors: [],
            warnings: [],
          },
          {
            rowNumber: 3,
            status: "invalid",
            normalized: { name: null },
            errors: ["Company name is required."],
            warnings: [],
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ summary: { committed: 1, invalid: 1 } }),
    });
  vi.stubGlobal("fetch", fetchMock);
  render(<ImportsPage role="member" />);
  const file = new File(
    ["name,organizationNumber\nAcme,AC-1\n,AC-2"],
    "companies.csv",
    { type: "text/csv" },
  );
  fireEvent.change(screen.getByLabelText("UTF-8 CSV file"), {
    target: { files: [file] },
  });
  await screen.findByText(/2 columns detected/u);
  expect((screen.getByLabelText("Name *") as HTMLSelectElement).value).toBe(
    "name",
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview and validate" }));
  expect(await screen.findByText("Company name is required.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Commit 1 rows" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "1 rows committed",
    ),
  );
  expect(fetchMock.mock.calls[0][0]).toBe("/api/imports/preview");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/imports/imp_1/commit");
});
