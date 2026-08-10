import { accessSync, constants, mkdirSync, realpathSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

export interface RuntimeConfig {
  host: string;
  port: number;
  databasePath: string;
  production: boolean;
}

function option(args: string[], name: string): string | undefined {
  const equals = args.find((value) => value.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function loadConfig(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const host = option(args, "--host") ?? env.NORTHSTAR_HOST ?? "127.0.0.1";
  const rawPort = option(args, "--port") ?? env.NORTHSTAR_PORT ?? "4173";
  const rawDatabase =
    option(args, "--database") ??
    env.NORTHSTAR_DB_PATH ??
    "data/northstar.sqlite";
  const port = Number(rawPort);

  if (!host.trim() || /[\s/]/.test(host))
    throw new Error("NORTHSTAR_HOST must be a hostname or IP address");
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("NORTHSTAR_PORT must be an integer between 1 and 65535");
  if (
    ![".db", ".sqlite", ".sqlite3"].includes(extname(rawDatabase).toLowerCase())
  )
    throw new Error(
      "NORTHSTAR_DB_PATH must name a .db, .sqlite, or .sqlite3 file",
    );

  const databasePath = resolve(rawDatabase);
  const parent = dirname(databasePath);
  mkdirSync(parent, { recursive: true });
  accessSync(realpathSync(parent), constants.R_OK | constants.W_OK);

  return {
    host,
    port,
    databasePath,
    production: env.NODE_ENV === "production",
  };
}
