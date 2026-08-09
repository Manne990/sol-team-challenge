import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdministrationPage } from "./AdministrationPage";
import type { AuthenticatedUser } from "../shared/auth";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const owner: AuthenticatedUser = {
  id: "user-owner",
  membershipId: "mem-owner",
  email: "owner@northstar.test",
  name: "Avery Owner",
  role: "owner",
  organization: { id: "org", name: "Northstar" },
  sessionExpiresAt: "2026-08-10T00:00:00Z",
};
test("deliberately forbids member administration", () => {
  render(<AdministrationPage user={{ ...owner, role: "member" }} />);
  expect(
    screen.getByRole("heading", { name: "Access restricted" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
});
test("owners see safe settings and member controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          path.includes("members")
            ? {
                members: [
                  {
                    id: "mem-owner",
                    name: "Avery Owner",
                    email: "owner@northstar.test",
                    role: "owner",
                  },
                ],
              }
            : {
                organization: {
                  id: "org",
                  name: "Northstar",
                  settings: {
                    currency: "SEK",
                    timezone: "Europe/Stockholm",
                    staleAccountDays: 30,
                  },
                  updatedAt: "2026-08-09T00:00:00Z",
                  version: 1,
                },
              },
      }),
    ),
  );
  render(<AdministrationPage user={owner} />);
  expect(await screen.findByDisplayValue("Northstar")).toBeTruthy();
  expect(screen.getByText("owner@northstar.test")).toBeTruthy();
  expect(screen.getByLabelText("Role for Avery Owner")).toBeTruthy();
  expect(screen.getByLabelText("Temporary password").getAttribute("type")).toBe(
    "password",
  );
});
