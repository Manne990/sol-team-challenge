import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductFixtures, FIXED_NOW } from "../fixtures/product-fixtures.mjs";
import { assertRejectedWithoutForeignMutation, snapshotOrganization } from "../support/isolation.mjs";

test("fixtures are repeatable and exercise product boundaries", () => {
  const first = createProductFixtures();
  const second = createProductFixtures();
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first.users.map((user) => user.role)), new Set(["owner", "member", "viewer"]));
  assert.equal(first.organizations.length, 2);
  assert.ok(first.companies.filter((company) => company.organizationId === "org_northstar_01").length > 25);
  assert.ok(first.companies.filter((company) => company.name === "Atlas Partners").length >= 3);
  assert.ok(first.stages.length >= 4);
  assert.ok(first.activities.some((activity) => Date.parse(activity.occurredAt) < FIXED_NOW.getTime() - 30 * 86_400_000));
  assert.ok(first.tasks.some((task) => Date.parse(task.dueAt) < FIXED_NOW.getTime() && task.status === "open"));
  assert.ok(first.tasks.some((task) => Date.parse(task.dueAt) > FIXED_NOW.getTime() && task.status === "open"));
});

test("isolation assertion checks the response and persisted foreign state", () => {
  const fixtures = createProductFixtures();
  const before = snapshotOrganization(fixtures.tasks, "org_outside_02");
  assertRejectedWithoutForeignMutation({ response: { status: 404 }, before, after: snapshotOrganization(fixtures.tasks, "org_outside_02") });
  assert.throws(
    () => assertRejectedWithoutForeignMutation({ response: { status: 403 }, before, after: before }),
    /must not disclose existence/,
  );
});
