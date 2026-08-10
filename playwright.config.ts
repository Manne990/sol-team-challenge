import { defineConfig, devices } from "@playwright/test";

const browserPort = Number(process.env.NORTHSTAR_BROWSER_PORT ?? "4317");

export default defineConfig({
  testDir: "tests/browser",
  forbidOnly: true,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${browserPort}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && node tests/browser/fixture-server.mjs",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(browserPort) },
    url: `http://127.0.0.1:${browserPort}/workspace`,
    reuseExistingServer: false,
  },
});
