import { afterEach, describe, expect, test } from "vitest";
import {
  createIsolatedDatabase,
  expectPersistedStateUnchanged,
  persistedBytes,
  type IsolatedDatabase,
} from "../helpers/isolated-database.js";

let isolated: IsolatedDatabase | undefined;
afterEach(() => isolated?.cleanup());

describe("tenant-negative integration assertions", () => {
  test("compare a denial response and unchanged persisted foreign state", () => {
    isolated = createIsolatedDatabase();
    isolated.database.exec(
      "CREATE TABLE company (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL); INSERT INTO company VALUES ('foreign', 'org_outside', 'Outside account')",
    );
    const before = persistedBytes(isolated.path);

    const actorOrganization = "org_northstar";
    const result = isolated.database
      .prepare(
        "UPDATE company SET name = ? WHERE id = ? AND organization_id = ?",
      )
      .run("Leaked", "foreign", actorOrganization);
    const response =
      result.changes === 0
        ? { status: 404, body: { code: "not_found" } }
        : { status: 200 };

    expect(response).toEqual({ status: 404, body: { code: "not_found" } });
    expectPersistedStateUnchanged(before, isolated.path);
  });
});
