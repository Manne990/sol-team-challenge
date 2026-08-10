import { createServer, type Server } from "node:http";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html lang="en"><head><title>Northstar test fixture</title></head><body><main><h1>Northstar CRM</h1><form><label>Email <input name="email" type="email" required></label><button>Sign in</button></form></main></body></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not allocate a TCP port");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("runs a keyboard-accessible critical path without accessibility violations", async ({
  page,
}) => {
  await page.goto(origin);
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByRole("button", { name: "Sign in" }).focus();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
