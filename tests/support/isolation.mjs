import assert from "node:assert/strict";

/** Capture stable persisted state, excluding fields a database may maintain as
 * internal query metadata. Call before an unauthorized request and compare
 * afterward so a correct-looking 403 cannot conceal a partial foreign write.
 */
export function snapshotOrganization(rows, organizationId) {
  return JSON.stringify(
    rows
      .filter((row) => row.organizationId === organizationId)
      .map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

export function assertRejectedWithoutForeignMutation({ response, expectedStatus = 404, before, after }) {
  assert.equal(response.status, expectedStatus, "foreign identifier response must not disclose existence");
  assert.equal(after, before, "authorization failure changed foreign persisted state");
}
