import { defineConfig } from "@playwright/test";

const port = Number(process.env.NORTHSTAR_TEST_PORT);
const databasePath = process.env.NORTHSTAR_TEST_DATABASE_PATH;
if (!Number.isInteger(port) || !databasePath) {
  throw new Error("Run browser tests through npm run test:browser to allocate isolated resources");
}

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: true,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/fixture-server.mjs",
    env: { HOST: "127.0.0.1", PORT: String(port), DATABASE_PATH: databasePath },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
