import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "src/**/*.test.{ts,tsx}",
      "test/companies-http.test.ts",
      "test/tasks-http.test.ts",
      "test/search-http.test.ts",
      "test/deals-http.test.ts",
      "test/imports-http.test.ts",
      "test/activities-http.test.ts",
      "test/duplicates-http.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
    restoreMocks: true,
    sequence: { concurrent: false },
  },
});
