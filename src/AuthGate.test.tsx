import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("authentication flow", () => {
  it("shows a keyboard-usable sign-in after an anonymous session check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<AuthGate>{() => <p>Workspace</p>}</AuthGate>);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(
      await screen.findByRole("heading", { name: "Sign in to Northstar" }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Email address").getAttribute("autocomplete"),
    ).toBe("username");
  });

  it("keeps generic credential failures actionable and permits retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: "Email or password is incorrect." },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthGate>{() => <p>Workspace</p>}</AuthGate>);
    fireEvent.change(await screen.findByLabelText("Email address"), {
      target: { value: "missing@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Email or password is incorrect.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" })
          .disabled,
      ).toBe(false),
    );
  });
});
