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
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }),
  );
  render(<App />);
  expect(screen.getByText(/Loading Northstar/)).toBeTruthy();
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
