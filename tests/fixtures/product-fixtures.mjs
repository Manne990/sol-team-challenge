const DAY = 86_400_000;

export const FIXED_NOW = new Date("2026-02-16T12:00:00.000Z");

const at = (days, hour = 12) =>
  new Date(FIXED_NOW.getTime() + days * DAY + (hour - 12) * 3_600_000).toISOString();

/**
 * Deterministic, organization-scoped records shared by integration and browser
 * tests. IDs deliberately resemble neither database rowids nor one another.
 */
export function createProductFixtures() {
  const organizations = [
    { id: "org_northstar_01", name: "Northstar Demo" },
    { id: "org_outside_02", name: "Outside Demo" },
  ];
  const users = [
    { id: "usr_owner_01", organizationId: organizations[0].id, email: "owner@northstar.test", password: "OwnerPass!2026", role: "owner" },
    { id: "usr_member_01", organizationId: organizations[0].id, email: "member@northstar.test", password: "MemberPass!2026", role: "member" },
    { id: "usr_viewer_01", organizationId: organizations[0].id, email: "viewer@northstar.test", password: "ViewerPass!2026", role: "viewer" },
    { id: "usr_owner_02", organizationId: organizations[1].id, email: "other-owner@outside.test", password: "OutsidePass!2026", role: "owner" },
  ];
  const stages = [
    ["stage_lead_01", "Lead", 0, 10],
    ["stage_qualified_01", "Qualified", 1, 35],
    ["stage_proposal_01", "Proposal", 2, 65],
    ["stage_won_01", "Won", 3, 100],
  ].map(([id, name, order, probability]) => ({ id, organizationId: organizations[0].id, name, order, probability }));

  // 31 records force a second page with the conventional 25-row page size.
  const companies = Array.from({ length: 31 }, (_, index) => ({
    id: `cmp_north_${String(index + 1).padStart(2, "0")}`,
    organizationId: organizations[0].id,
    name: index < 2 ? "Atlas Partners" : `Northstar Account ${String(index + 1).padStart(2, "0")}`,
    organizationNumber: `NS-${String(index + 1).padStart(4, "0")}`,
    lifecycleStatus: index % 3 === 0 ? "customer" : "prospect",
    ownerId: index % 2 === 0 ? users[0].id : users[1].id,
    createdAt: at(-90 + index),
    updatedAt: at(-30 + index),
  }));
  companies.push({
    id: "cmp_outside_01",
    organizationId: organizations[1].id,
    name: "Atlas Partners",
    organizationNumber: "OUT-0001",
    lifecycleStatus: "customer",
    ownerId: users[3].id,
    createdAt: at(-80),
    updatedAt: at(-1),
  });

  const contacts = companies.map((company, index) => ({
    id: `ctc_${company.id}`,
    organizationId: company.organizationId,
    companyId: company.id,
    firstName: index < 2 ? "Alex" : `Contact${index + 1}`,
    lastName: index < 2 ? "Morgan" : "Example",
    email: `contact${index + 1}@example.test`,
    ownerId: company.ownerId,
    status: "active",
  }));
  const activities = [-120, -45, -7, -1].map((days, index) => ({
    id: `act_history_${index + 1}`,
    organizationId: organizations[0].id,
    companyId: companies[index].id,
    creatorId: index % 2 ? users[1].id : users[0].id,
    type: ["call", "email", "meeting", "note"][index],
    subject: `Historical activity ${index + 1}`,
    occurredAt: at(days),
  }));
  activities.push({
    id: "act_outside_01",
    organizationId: organizations[1].id,
    companyId: "cmp_outside_01",
    creatorId: users[3].id,
    type: "note",
    subject: "Foreign private history",
    occurredAt: at(-2),
  });
  const deals = stages.map((stage, index) => ({
    id: `deal_north_${index + 1}`,
    organizationId: organizations[0].id,
    companyId: companies[index].id,
    stageId: stage.id,
    name: `${stage.name} opportunity`,
    amountMinor: (index + 1) * 125_000,
    currency: "USD",
    expectedCloseDate: at(index + 5).slice(0, 10),
  }));
  const tasks = [
    { id: "task_overdue_01", organizationId: organizations[0].id, assigneeId: users[1].id, title: "Overdue follow-up", dueAt: at(-2), status: "open" },
    { id: "task_today_01", organizationId: organizations[0].id, assigneeId: users[0].id, title: "Due today", dueAt: at(0, 16), status: "open" },
    { id: "task_upcoming_01", organizationId: organizations[0].id, assigneeId: users[1].id, title: "Upcoming renewal", dueAt: at(5), status: "open" },
    { id: "task_completed_01", organizationId: organizations[0].id, assigneeId: users[0].id, title: "Completed task", dueAt: at(-10), status: "completed", completedAt: at(-9) },
    { id: "task_outside_01", organizationId: organizations[1].id, assigneeId: users[3].id, title: "Foreign private task", dueAt: at(-1), status: "open" },
  ];

  return structuredClone({ organizations, users, stages, companies, contacts, activities, deals, tasks });
}

export const publicFixtureCredentials = Object.freeze({
  owner: { email: "owner@northstar.test", password: "OwnerPass!2026" },
  member: { email: "member@northstar.test", password: "MemberPass!2026" },
  viewer: { email: "viewer@northstar.test", password: "ViewerPass!2026" },
  outsideOwner: { email: "other-owner@outside.test", password: "OutsidePass!2026" },
});
