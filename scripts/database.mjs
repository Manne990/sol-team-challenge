import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const databasePath = () =>
  resolve(
    process.env.NORTHSTAR_DB_PATH || resolve(root, "data/northstar.sqlite"),
  );

export function openDatabase(path = databasePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  return db;
}

export function migrate(db) {
  const migrationDir = resolve(root, "db/migrations");
  const files = readdirSync(migrationDir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const hasLedger = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();
  const applied = hasLedger
    ? new Set(
        db
          .prepare("SELECT version FROM schema_migrations")
          .all()
          .map(({ version }) => version),
      )
    : new Set();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(readFileSync(resolve(migrationDir, file), "utf8"));
      db.prepare(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      ).run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function resetDatabase(path = databasePath()) {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${path}${suffix}`, { force: true });
  const db = openDatabase(path);
  migrate(db);
  db.close();
}
