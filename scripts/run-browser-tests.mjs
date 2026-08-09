import { spawn, spawnSync } from "node:child_process";
import { createTestRuntime } from "../tests/support/test-runtime.mjs";

const runtime = await createTestRuntime();
let browser;
let server;
let stopping = false;
const stop = async (signal) => {
  if (stopping) return;
  stopping = true;
  if (browser && !browser.killed) browser.kill(signal);
  if (server && !server.killed) server.kill(signal);
  await runtime.dispose();
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop(signal);
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  });
}

try {
  const databaseEnvironment = {
    ...process.env,
    NORTHSTAR_DB_PATH: runtime.databasePath,
  };
  for (const command of ["db:reset", "db:seed"]) {
    const setup = spawnSync("npm", ["run", command], {
      stdio: "inherit",
      env: databaseEnvironment,
    });
    if (setup.status !== 0)
      throw new Error(`${command} failed for the browser database`);
  }

  server = spawn(
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
      stdio: ["ignore", "pipe", "inherit"],
      env: {
        ...databaseEnvironment,
        NORTHSTAR_TEST_EPHEMERAL_PORT: "1",
      },
    },
  );
  server.stdout.pipe(process.stdout);
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for the browser server")),
      30_000,
    );
    let output = "";
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    server.once("error", fail);
    server.once("exit", (code, signal) =>
      fail(
        new Error(
          `Browser server exited before startup (${code ?? signal ?? "unknown"})`,
        ),
      ),
    );
    server.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(
        /Northstar CRM listening at http:\/\/127\.0\.0\.1:(\d+)/u,
      );
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
  });

  browser = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NORTHSTAR_TEST_PORT: String(port),
        NORTHSTAR_TEST_OUTPUT_DIR: `${runtime.directory}/playwright-results`,
      },
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    browser.once("error", reject);
    browser.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} finally {
  await stop("SIGTERM");
}
