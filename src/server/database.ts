import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openProductDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL) STRICT",
  );
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version=?");
  const record = db.prepare(
    "INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)",
  );
  for (const name of readdirSync(resolve("migrations"))
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    if (applied.get(name)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(readFileSync(resolve("migrations", name), "utf8"));
      record.run(name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw new Error(`Migration ${name} failed`, { cause: error });
    }
  }
  return db;
}
