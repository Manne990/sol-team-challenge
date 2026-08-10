import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "src/**/*.test.ts",
      "test/companies-http.test.ts",
      "test/tasks-http.test.ts",
      "test/deals-http.test.ts",
      "test/imports-http.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
    restoreMocks: true,
    sequence: { concurrent: true },
  },
});
