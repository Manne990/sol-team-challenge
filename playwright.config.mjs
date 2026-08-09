import { defineConfig } from "@playwright/test";

const port = Number(process.env.NORTHSTAR_TEST_PORT);
const outputDir = process.env.NORTHSTAR_TEST_OUTPUT_DIR;
if (!Number.isInteger(port) || port < 1 || !outputDir) {
  throw new Error(
    "Run browser tests through npm run test:browser to allocate isolated resources",
  );
}

export default defineConfig({
  testDir: "./tests/browser",
  outputDir,
  forbidOnly: true,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
});
