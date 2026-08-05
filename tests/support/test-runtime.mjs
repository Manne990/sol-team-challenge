import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function reservePort(host = "127.0.0.1") {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error("Unable to allocate an isolated test port");
  return port;
}

export async function createTestRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "northstar-test-"));
  let disposed = false;
  return {
    directory,
    databasePath: join(directory, "northstar.sqlite"),
    port: await reservePort(),
    async dispose() {
      if (disposed) return;
      disposed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
