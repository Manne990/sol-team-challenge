import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface IsolatedDatabase {
  database: DatabaseSync;
  path: string;
  cleanup(): void;
}

export function createIsolatedDatabase(): IsolatedDatabase {
  const directory = mkdtempSync(join(tmpdir(), "northstar-test-"));
  const path = join(directory, "test.sqlite");
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  return {
    database,
    path,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function persistedBytes(path: string): Buffer {
  return readFileSync(path);
}

export function expectPersistedStateUnchanged(
  before: Buffer,
  path: string,
): void {
  const after = persistedBytes(path);
  if (!before.equals(after))
    throw new Error("Denied operation changed persisted foreign state");
}
