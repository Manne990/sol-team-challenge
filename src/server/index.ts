import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openProductDatabase } from "./database.js";

async function main() {
  const config = loadConfig();
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

  const database = openProductDatabase(config.databasePath);
  const app = createApp(
    database as unknown as import("./auth/sqlite-store.js").SqliteDatabase,
  );
  if (config.production) {
    const root = path.resolve("dist/client");
    const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
    app.use(express.static(root));
    app.get("/{*path}", (_request, response) =>
      response.type("html").send(indexHtml),
    );
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = createServer(app);
  server.on("error", (error) => {
    console.error("Northstar failed to start", error);
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `Northstar CRM listening at http://${config.host}:${config.port}`,
    );
    console.log(`Database path: ${config.databasePath}`);
  });

  const shutdown = () =>
    server.close(() => {
      database.close();
      process.exit(0);
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Northstar failed to start",
  );
  process.exitCode = 1;
});
