import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

async function start() {
  const config = loadConfig();
  const database = new DatabaseSync(config.databasePath);
  database.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  const app = createApp(database, config.production);

  if (config.production) {
    const clientDirectory = resolve("dist/client");
    if (!existsSync(clientDirectory))
      throw new Error(
        "Built client assets are missing; run npm run build first",
      );
    app.use(
      await import("express").then(({ default: express }) =>
        express.static(clientDirectory),
      ),
    );
    const indexHtml = readFileSync(
      resolve(clientDirectory, "index.html"),
      "utf8",
    );
    app.use((_request, response) => response.type("html").send(indexHtml));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `Northstar CRM listening on http://${config.host}:${config.port}`,
    );
    console.log(`Database: ${config.databasePath}`);
  });
  const shutdown = () =>
    server.close(() => {
      database.close();
      process.exit(0);
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error: unknown) => {
  console.error(
    `Northstar CRM failed to start: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
