import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const worktreePort =
  30_000 +
  (Number.parseInt(
    createHash("sha256").update(process.cwd()).digest("hex").slice(0, 8),
    16,
  ) %
    20_000);
const browserPort = Number(process.env.NORTHSTAR_BROWSER_PORT ?? worktreePort);
const browserDatabase = join(
  "/tmp",
  `northstar-real-browser-${browserPort}.sqlite`,
);

export default defineConfig({
  testDir: "tests/real-browser",
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${browserPort}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run db:reset && npm run db:seed && npm run dev -- --host 127.0.0.1 --port ${browserPort}`,
    env: {
      ...process.env,
      NORTHSTAR_DB_PATH: browserDatabase,
    },
    url: `http://127.0.0.1:${browserPort}/api/health`,
    reuseExistingServer: false,
  },
});
