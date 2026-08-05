import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function databasePath() {
  return resolve(process.env.NORTHSTAR_DB_PATH || resolve(root, "data/northstar.sqlite"));
}

export function openDatabase(path = databasePath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  return db;
}

export function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT");
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version=?");
  const record = db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)");
  for (const name of readdirSync(resolve(root, "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    if (applied.get(name)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(readFileSync(resolve(root, "migrations", name), "utf8"));
      record.run(name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${name} failed`, { cause: error });
    }
  }
}

export function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
