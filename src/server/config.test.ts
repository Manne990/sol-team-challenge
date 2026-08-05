import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("runtime configuration", () => {
  it("accepts forwarded host and port arguments", () => {
    const config = loadConfig(["--host", "0.0.0.0", "--port=4512"], {});
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(4512);
    expect(config.databasePath).toMatch(/data[/\\]northstar\.sqlite$/u);
  });

  it.each(["0", "65536", "words"])("rejects invalid port %s", (port) => {
    expect(() => loadConfig([], { NORTHSTAR_PORT: port })).toThrow(
      "Invalid port",
    );
  });

  it("rejects an empty database path", () => {
    expect(() => loadConfig([], { NORTHSTAR_DB_PATH: " " })).toThrow(
      "Invalid NORTHSTAR_DB_PATH",
    );
  });
});
