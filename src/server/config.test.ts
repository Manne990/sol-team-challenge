import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("runtime configuration", () => {
  it("honors CLI host and port over environment values", () => {
    const directory = mkdtempSync(join(tmpdir(), "northstar-config-"));
    const config = loadConfig(
      [
        "--host",
        "0.0.0.0",
        "--port=4317",
        "--database",
        join(directory, "crm.sqlite"),
      ],
      { NORTHSTAR_HOST: "localhost", NORTHSTAR_PORT: "9999" },
    );
    expect(config).toMatchObject({ host: "0.0.0.0", port: 4317 });
  });
  it.each(["0", "65536", "not-a-port"])("rejects invalid port %s", (port) => {
    expect(() => loadConfig([], { NORTHSTAR_PORT: port })).toThrow(
      "NORTHSTAR_PORT",
    );
  });
  it("rejects a database path that is not a SQLite file", () => {
    expect(() => loadConfig([], { NORTHSTAR_DB_PATH: "data/crm.txt" })).toThrow(
      "NORTHSTAR_DB_PATH",
    );
  });
});
