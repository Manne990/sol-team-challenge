export const CLOCK = new Date("2026-08-10T09:00:00.000Z");

export type Role = "owner" | "member" | "viewer";

const northstarUsers = [
  ["usr_north_owner", "owner@northstar.test", "owner"],
  ["usr_north_member", "member@northstar.test", "member"],
  ["usr_north_viewer", "viewer@northstar.test", "viewer"],
] as const;

export function productFixtures() {
  const companies = Array.from({ length: 27 }, (_, index) => ({
    id: `cmp_north_${String(index + 1).padStart(2, "0")}`,
    organizationId: "org_northstar",
    name:
      index < 2
        ? "Acme Duplicate"
        : `Northstar Account ${String(index + 1).padStart(2, "0")}`,
  }));

  return structuredClone({
    now: CLOCK.toISOString(),
    organizations: [
      { id: "org_northstar", name: "Northstar Demo" },
      { id: "org_outside", name: "Outside Demo" },
    ],
    users: [
      ...northstarUsers.map(([id, email, role]) => ({
        id,
        email,
        role: role as Role,
        organizationId: "org_northstar",
      })),
      {
        id: "usr_outside_owner",
        email: "other-owner@outside.test",
        role: "owner" as Role,
        organizationId: "org_outside",
      },
    ],
    companies: [
      ...companies,
      {
        id: "cmp_outside_01",
        organizationId: "org_outside",
        name: "Acme Duplicate",
      },
    ],
    pipelineStages: [
      {
        id: "stage_lead",
        organizationId: "org_northstar",
        name: "Lead",
        order: 1,
      },
      {
        id: "stage_qualified",
        organizationId: "org_northstar",
        name: "Qualified",
        order: 2,
      },
      {
        id: "stage_proposal",
        organizationId: "org_northstar",
        name: "Proposal",
        order: 3,
      },
    ],
    activities: [
      {
        id: "act_historical",
        organizationId: "org_northstar",
        companyId: "cmp_north_01",
        occurredAt: "2025-02-03T14:30:00.000Z",
        type: "call",
      },
    ],
    tasks: [
      {
        id: "task_overdue",
        organizationId: "org_northstar",
        dueAt: "2026-08-09T08:00:00.000Z",
        status: "open",
      },
      {
        id: "task_upcoming",
        organizationId: "org_northstar",
        dueAt: "2026-08-14T08:00:00.000Z",
        status: "open",
      },
    ],
  });
}
