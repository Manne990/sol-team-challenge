import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import type { AuthenticatedUser } from "../shared/auth";
import { CompanyError, CompanyService } from "./companies";

const owner: AuthenticatedUser = {
  id: "usr_owner",
  membershipId: "mem_owner",
  email: "owner@northstar.test",
  name: "Avery Owner",
  role: "owner",
  organization: { id: "org_northstar", name: "Northstar Demo" },
  sessionExpiresAt: "2099-01-01T00:00:00Z",
};
const viewer: AuthenticatedUser = {
  ...owner,
  id: "usr_viewer",
  membershipId: "mem_viewer",
  role: "viewer",
};
const outside: AuthenticatedUser = {
  ...owner,
  id: "usr_outside",
  membershipId: "mem_outside",
  role: "owner",
  organization: { id: "org_outside", name: "Outside Demo" },
};

function seed(database: Database.Database) {
  const now = "2026-08-05T12:00:00.000Z";
  database
    .prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .run("org_northstar", "Northstar Demo", "northstar", now, now);
  database
    .prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .run("org_outside", "Outside Demo", "outside", now, now);
  const user = database.prepare(
    "INSERT INTO users(id,email,password_hash,first_name,last_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  );
  user.run(
    "usr_owner",
    "owner@northstar.test",
    "test",
    "Avery",
    "Owner",
    now,
    now,
  );
  user.run(
    "usr_viewer",
    "viewer@northstar.test",
    "test",
    "Vera",
    "Viewer",
    now,
    now,
  );
  user.run(
    "usr_outside",
    "outside@test.invalid",
    "test",
    "Otto",
    "Outside",
    now,
    now,
  );
  const member = database.prepare(
    "INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  );
  member.run(
    "mem_owner",
    "org_northstar",
    "usr_owner",
    "owner",
    "active",
    now,
    now,
  );
  member.run(
    "mem_viewer",
    "org_northstar",
    "usr_viewer",
    "viewer",
    "active",
    now,
    now,
  );
  member.run(
    "mem_outside",
    "org_outside",
    "usr_outside",
    "owner",
    "active",
    now,
    now,
  );
  const company = database.prepare(
    "INSERT INTO companies(id,organization_id,name,organization_number,external_reference,industry,size,lifecycle_status,owner_membership_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (let number = 1; number <= 24; number++)
    company.run(
      `cmp_${String(number).padStart(4, "0")}_northstar`,
      "org_northstar",
      `Northstar Account ${number}`,
      `SE-${number}`,
      `EXT-${number}`,
      number % 2 ? "Technology" : "Retail",
      number % 2 ? "medium" : "large",
      number % 3 ? "customer" : "prospect",
      "mem_owner",
      now,
      now,
    );
  company.run(
    "cmp_outside",
    "org_outside",
    "Outside Secret AB",
    "OUT-1",
    "OUTSIDE-1",
    "Private",
    "small",
    "customer",
    "mem_outside",
    now,
    now,
  );
}

describe("company management", () => {
  let directory: string;
  let database: Database.Database;
  let service: CompanyService;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "northstar-companies-"));
    database = new Database(join(directory, "crm.sqlite"));
    database.pragma("foreign_keys=ON");
    database.exec(
      readFileSync(join(process.cwd(), "migrations/001_initial.sql"), "utf8"),
    );
    seed(database);
    service = new CompanyService(database);
  });
  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  test("lists with tenant-scoped combined filters and pagination", () => {
    const result = service.list(owner, {
      q: "Account",
      lifecycle: "customer",
      industry: "Technology",
      page: "1",
      pageSize: "3",
      sort: "updatedAt",
      direction: "desc",
    });
    expect(result.companies.length).toBeLessThanOrEqual(3);
    expect(
      result.companies.every(
        (company) =>
          company.name !== "Outside Secret AB" &&
          company.lifecycleStatus === "customer" &&
          company.industry === "Technology",
      ),
    ).toBe(true);
  });
  test("creates, updates, archives, restores, and retains connected history", () => {
    const created = service.create(owner, {
      name: "Polar Systems",
      organizationNumber: "POLAR-1",
      externalReference: "CRM-900",
      website: "https://polar.example",
      phone: "+46 8 1",
      industry: "Technology",
      size: "medium",
      address: { city: "Stockholm", country: "SE" },
      lifecycleStatus: "prospect",
      ownerMembershipId: "mem_owner",
      tags: ["priority"],
      description: "Strategic prospect",
    });
    expect(created.history[0]?.action).toBe("company.created");
    const updated = service.update(owner, created.id, {
      ...created,
      name: "Polar Systems AB",
      ownerMembershipId: created.owner?.id,
    });
    expect(updated.name).toBe("Polar Systems AB");
    expect(service.archive(owner, created.id).archivedAt).toBeTruthy();
    expect(service.list(owner, { q: "Polar" }).companies).toHaveLength(0);
    expect(service.archive(owner, created.id, true).archivedAt).toBeNull();
    expect(
      service.detail(owner, created.id).history.map((item) => item.action),
    ).toEqual(
      expect.arrayContaining([
        "company.created",
        "company.updated",
        "company.archived",
        "company.restored",
      ]),
    );
  });
  test("returns deterministic duplicate and stale-edit conflicts", () => {
    const first = service.detail(owner, "cmp_0001_northstar");
    expect(() =>
      service.create(owner, {
        name: "Duplicate",
        organizationNumber: first.organizationNumber,
        lifecycleStatus: "lead",
      }),
    ).toThrowError(CompanyError);
    service.update(owner, first.id, {
      ...first,
      name: "Fresh edit",
      ownerMembershipId: first.owner?.id,
    });
    expect(() =>
      service.update(owner, first.id, {
        ...first,
        name: "Stale edit",
        ownerMembershipId: first.owner?.id,
      }),
    ).toThrowError(/changed since/iu);
  });
  test("keeps viewer mutations forbidden and foreign identifiers opaque", () => {
    expect(() =>
      service.create(viewer, { name: "Blocked", lifecycleStatus: "lead" }),
    ).toThrowError(/permission/iu);
    expect(() => service.detail(owner, "cmp_outside")).toThrowError(
      /not found/iu,
    );
    expect(service.detail(outside, "cmp_outside").name).toBe(
      "Outside Secret AB",
    );
  });
});
