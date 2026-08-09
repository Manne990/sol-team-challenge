import path from "node:path";

export interface RuntimeConfig {
  host: string;
  port: number;
  databasePath: string;
  production: boolean;
}

function option(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function validHost(value: string): boolean {
  return value.length > 0 && !/[\s/]/u.test(value);
}

export function loadConfig(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const host = option(args, "--host") ?? env.NORTHSTAR_HOST ?? "127.0.0.1";
  const portText = option(args, "--port") ?? env.NORTHSTAR_PORT ?? "4173";
  const databaseInput = env.NORTHSTAR_DB_PATH ?? "data/northstar.sqlite";
  const port = Number(portText);
  const ephemeralTestPort =
    port === 0 && env.NORTHSTAR_TEST_EPHEMERAL_PORT === "1";

  if (!validHost(host))
    throw new Error("Invalid host: provide a hostname or IP address");
  if (
    !Number.isInteger(port) ||
    (!ephemeralTestPort && port < 1) ||
    port > 65_535
  ) {
    throw new Error("Invalid port: expected an integer from 1 to 65535");
  }
  if (!databaseInput.trim() || databaseInput.includes("\0")) {
    throw new Error("Invalid NORTHSTAR_DB_PATH: provide a filesystem path");
  }

  return {
    host,
    port,
    databasePath: path.resolve(databaseInput),
    production: env.NODE_ENV === "production",
  };
}
