import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { createTestRuntime } from "../support/test-runtime.mjs";

test("test runtimes get unique ports and temporary databases that are removed", async () => {
  const first = await createTestRuntime();
  const second = await createTestRuntime();
  try {
    assert.notEqual(first.port, second.port);
    assert.notEqual(first.databasePath, second.databasePath);
    await writeFile(first.databasePath, "isolated test state");
    await access(first.databasePath);
  } finally {
    await first.dispose();
    await second.dispose();
  }
  await assert.rejects(access(first.databasePath), { code: "ENOENT" });
});
