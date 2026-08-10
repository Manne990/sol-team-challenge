import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

let server: Server | undefined;
afterEach(() => server?.close());
async function request(path: string) {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP server");
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}
describe("application API", () => {
  it("reports health without leaking runtime configuration", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      service: "northstar-crm",
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
  it("returns a stable corrective error for unknown APIs", async () => {
    const response = await request("/api/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  });
});
