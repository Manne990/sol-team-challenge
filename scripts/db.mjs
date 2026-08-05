import { rmSync } from "node:fs";
import { databasePath, migrate, openDatabase } from "../src/db/database.mjs";
import { seedDatabase } from "../src/db/seed.mjs";

const command = process.argv[2];
const path = databasePath();
if (command === "reset")
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(`${path}${suffix}`, { force: true });
if (!["reset", "seed"].includes(command))
  throw new Error("Usage: node scripts/db.mjs <reset|seed>");
const db = openDatabase(path);
try {
  migrate(db);
  if (command === "seed") seedDatabase(db);
  console.log(`database ${command} complete: ${path}`);
} finally {
  db.close();
}
