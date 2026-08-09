import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { createTestRuntime } from "../support/test-runtime.mjs";

async function startEphemeralServer(databasePath) {
  const child = spawn(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "src/server/index.ts",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NORTHSTAR_DB_PATH: databasePath,
        NORTHSTAR_TEST_EPHEMERAL_PORT: "1",
      },
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Server startup timed out:\n${output}`)),
      30_000,
    );
    const inspect = () => {
      const match = output.match(
        /Northstar CRM listening at http:\/\/127\.0\.0\.1:(\d+)/u,
      );
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    };
    child.stdout.on("data", inspect);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Server exited before startup (${code ?? signal ?? "unknown"}):\n${output}`,
        ),
      );
    });
  });
  return { child, port, output: () => output };
}

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

test("concurrent browser servers bind isolated HTTP and WebSocket resources", async () => {
  const firstRuntime = await createTestRuntime();
  const secondRuntime = await createTestRuntime();
  let first;
  let second;
  try {
    [first, second] = await Promise.all([
      startEphemeralServer(firstRuntime.databasePath),
      startEphemeralServer(secondRuntime.databasePath),
    ]);
    assert.notEqual(first.port, second.port);
    for (const server of [first, second]) {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/health`,
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(server.output(), /WebSocket server error/u);
    }
  } finally {
    first?.child.kill("SIGTERM");
    second?.child.kill("SIGTERM");
    await firstRuntime.dispose();
    await secondRuntime.dispose();
  }
});
