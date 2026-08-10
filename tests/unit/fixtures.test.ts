import { describe, expect, test } from "vitest";
import { productFixtures } from "../fixtures/product.js";

describe("deterministic product fixtures", () => {
  test("represent both tenants, every role, pagination, duplicates, history, pipeline, and due states", () => {
    const first = productFixtures();
    expect(productFixtures()).toEqual(first);
    expect(new Set(first.organizations.map(({ id }) => id))).toHaveProperty(
      "size",
      2,
    );
    expect(
      first.users
        .filter(({ organizationId }) => organizationId === "org_northstar")
        .map(({ role }) => role),
    ).toEqual(["owner", "member", "viewer"]);
    expect(
      first.companies.filter(
        ({ organizationId }) => organizationId === "org_northstar",
      ),
    ).toHaveLength(27);
    expect(
      first.companies.filter(({ name }) => name === "Acme Duplicate"),
    ).toHaveLength(3);
    expect(first.pipelineStages).toHaveLength(3);
    expect(Date.parse(first.activities[0]!.occurredAt)).toBeLessThan(
      Date.parse(first.now),
    );
    expect(first.tasks.map(({ id }) => id)).toEqual([
      "task_overdue",
      "task_upcoming",
    ]);
  });
});
