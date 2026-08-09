import { spawn } from "node:child_process";
import { createTestRuntime } from "../tests/support/test-runtime.mjs";

const runtime = await createTestRuntime();
let child;
let stopping = false;
const stop = async (signal) => {
  if (stopping) return;
  stopping = true;
  if (child && !child.killed) child.kill(signal);
  await runtime.dispose();
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop(signal);
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  });
}

try {
  child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NORTHSTAR_TEST_PORT: String(runtime.port), NORTHSTAR_TEST_DATABASE_PATH: runtime.databasePath },
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} finally {
  await stop("SIGTERM");
}
