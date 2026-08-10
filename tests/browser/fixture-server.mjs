/* global process, URL, console */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1) throw new Error("PORT is required");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Northstar test harness</title><style>
body{font:16px system-ui;background:#f7f8fa;color:#17202a;margin:0}main{max-width:28rem;margin:8vh auto;padding:2rem}
label{display:block;margin:.75rem 0 .25rem}input,button{box-sizing:border-box;font:inherit;width:100%;padding:.7rem}
button{margin-top:1rem;background:#174ea6;color:#fff;border:0;border-radius:.25rem}*:focus-visible{outline:3px solid #b45309;outline-offset:2px}
</style></head><body><main><h1>Sign in to Northstar</h1><form id="login">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button>Sign in</button></form><p id="status" role="status"></p></main>
<script>document.querySelector('#login').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#status').textContent='Signed in for browser harness verification';});</script>
</body></html>`;

const clientRoot = join(process.cwd(), "dist/client");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};
const companies = [
  {
    id: "fixture-company",
    name: "Acme Nordic AB",
    organizationNumber: "SE-559001-1200",
    externalReference: null,
    website: null,
    phone: null,
    industry: "Manufacturing",
    size: "medium",
    address: null,
    lifecycleStatus: "customer",
    ownerId: "usr_northstar_owner",
    ownerName: "Morgan Lee",
    tags: ["priority"],
    description: "",
    archivedAt: null,
    createdAt: "2026-08-09T13:15:00Z",
    updatedAt: "2026-08-09T13:15:00Z",
    version: 1,
  },
];
const tasks = [
  {
    id: "fixture-task",
    title: "Review proposal",
    description: "",
    assigneeId: "usr_northstar_owner",
    assigneeName: "Morgan Lee",
    dueAt: "2026-08-09T09:00:00.000Z",
    priority: "high",
    status: "open",
    dueState: "overdue",
    companyName: "Acme Nordic AB",
    contactName: null,
    dealName: null,
    version: 1,
  },
];
const savedViews = [];
const fixtureDeals = [
  {
    id: "deal_fixture",
    name: "Acme expansion",
    company: { id: "fixture-company", name: "Acme Nordic AB" },
    owner: { id: "usr_northstar_owner", name: "Northstar Owner" },
    amountMinor: 2500000,
    currency: "SEK",
    probability: 40,
    stage: { id: "stage_lead", name: "Qualification", position: 0 },
    status: "open",
    lossReason: null,
    expectedCloseDate: "2026-10-20",
    version: 1,
  },
];
const activities = [
  {
    id: "activity_fixture",
    type: "call",
    subject: "Renewal call",
    body: "Reviewed the renewal timeline.",
    occurredAt: "2026-08-09T13:15:00.000Z",
    creator: { id: "usr_northstar_owner", name: "Northstar Owner" },
    company: { id: "company_fixture", name: "Acme Nordic AB" },
    contact: null,
    deal: null,
    followUpTaskId: null,
    version: 1,
  },
];

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`)
    .pathname;
  if (pathname === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ok",
        service: "northstar-crm",
        timestamp: new Date(0).toISOString(),
      }),
    );
    return;
  }
  if (pathname === "/api/auth/session" && request.method === "GET") {
    const authenticated =
      request.headers.cookie?.includes("northstar_session=fixture") ?? false;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      authenticated
        ? JSON.stringify({
            authenticated: true,
            userId: "usr_northstar_owner",
            organizationId: "org_northstar_demo",
            role: "owner",
            expiresAt: "2026-08-11T00:00:00.000Z",
          })
        : JSON.stringify({ authenticated: false }),
    );
    return;
  }
  if (pathname === "/api/auth/session" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const credentials = JSON.parse(body);
      if (
        credentials.email !== "owner@northstar.test" ||
        credentials.password !== "OwnerPass!2026"
      ) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              code: "invalid_credentials",
              message: "The email or password is incorrect.",
            },
          }),
        );
        return;
      }
      response.writeHead(201, {
        "content-type": "application/json",
        "set-cookie":
          "northstar_session=fixture; Path=/; HttpOnly; SameSite=Lax",
      });
      response.end(
        JSON.stringify({
          authenticated: true,
          userId: "usr_northstar_owner",
          organizationId: "org_northstar_demo",
          role: "owner",
          expiresAt: "2026-08-11T00:00:00.000Z",
        }),
      );
    });
    return;
  }
  if (pathname === "/api/auth/session" && request.method === "DELETE") {
    response.writeHead(204, {
      "set-cookie":
        "northstar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    });
    response.end();
    return;
  }
  if (pathname === "/api/imports/preview" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const invalid = payload.csv.includes("\n,INVALID");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "fixture-import",
          kind: payload.kind,
          status: "preview",
          rowCount: invalid ? 2 : 1,
          validCount: 1,
          errorCount: invalid ? 1 : 0,
          committedAt: null,
          rows: [
            {
              row: 2,
              values: {
                name: "Browser Company",
                organizationNumber: "BROWSER-1",
              },
              errors: [],
              warnings: [],
            },
            ...(invalid
              ? [
                  {
                    row: 3,
                    values: { name: "", organizationNumber: "INVALID" },
                    errors: ["Company name is required."],
                    warnings: [],
                  },
                ]
              : []),
          ],
        }),
      );
    });
    return;
  }
  if (
    pathname === "/api/imports/fixture-import/commit" &&
    request.method === "POST"
  ) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "fixture-import",
        kind: "companies",
        status: "committed",
        rowCount: 2,
        validCount: 1,
        errorCount: 1,
        committedAt: new Date().toISOString(),
        rows: [
          {
            row: 2,
            values: { name: "Browser Company" },
            errors: [],
            warnings: [],
          },
          {
            row: 3,
            values: { name: "" },
            errors: ["Company name is required."],
            warnings: [],
          },
        ],
      }),
    );
    return;
  }
  if (
    pathname.startsWith("/api/imports/exports/") &&
    request.method === "GET"
  ) {
    response.writeHead(200, {
      "content-type": "text/csv",
      "content-disposition": "attachment; filename=export.csv",
    });
    response.end("id,name\r\nfixture,Browser Company\r\n");
    return;
  }
  if (pathname === "/api/companies" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        items: companies,
        page: 1,
        pageSize: 20,
        total: companies.length,
        totalPages: 1,
      }),
    );
    return;
  }
  if (pathname === "/api/contacts" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        contacts: [
          {
            id: "contact_fixture",
            firstName: "Avery",
            lastName: "Stone",
            name: "Avery Stone",
            email: "avery@example.test",
            phone: "+46 70 123 45 67",
            jobTitle: "Buyer",
            status: "active",
            tags: ["vip"],
            communicationPreference: "email",
            company: { id: "company_fixture", name: "Acme Nordic AB" },
            owner: { id: "usr_northstar_owner", name: "Northstar Owner" },
            archivedAt: null,
            version: 1,
          },
        ],
        pagination: { page: 1, pageSize: 25, total: 1, pages: 1 },
      }),
    );
    return;
  }
  if (pathname === "/api/deals" && request.method === "GET") {
    const stages = [
      {
        id: "stage_lead",
        name: "Qualification",
        position: 0,
        color: "#2563eb",
      },
      { id: "stage_proposal", name: "Proposal", position: 1, color: "#7c3aed" },
    ];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        items: fixtureDeals,
        stages: stages.map((stage) => ({
          ...stage,
          deals: fixtureDeals.filter((deal) => deal.stage.id === stage.id),
        })),
        page: 1,
        pageSize: 20,
        total: fixtureDeals.length,
        totalPages: 1,
      }),
    );
    return;
  }
  if (pathname === "/api/activities" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        items: activities,
        page: 1,
        pageSize: 25,
        total: activities.length,
        totalPages: 1,
      }),
    );
    return;
  }
  if (pathname === "/api/deals" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body);
      const deal = {
        ...fixtureDeals[0],
        id: `deal_fixture_${fixtureDeals.length}`,
        name: input.name,
        company: { id: input.companyId, name: "Acme Nordic AB" },
        amountMinor: input.amountMinor,
        currency: input.currency,
        probability: input.probability,
        stage: { id: input.stageId, name: "Qualification", position: 0 },
      };
      fixtureDeals.push(deal);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(deal));
    });
    return;
  }
  if (pathname === "/api/activities" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body);
      const activity = {
        ...activities[0],
        id: `activity_${activities.length + 1}`,
        type: input.type,
        subject: input.subject,
        body: input.body,
        occurredAt: input.occurredAt,
        company: null,
        followUpTaskId: null,
      };
      activities.unshift(activity);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ ...activity, participants: [], followUpTask: null }),
      );
    });
    return;
  }
  if (pathname.startsWith("/api/activities/") && request.method === "GET") {
    const activity = activities.find(
      (item) => item.id === pathname.split("/").at(-1),
    );
    response.writeHead(activity ? 200 : 404, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify(
        activity
          ? { ...activity, participants: [] }
          : { error: { message: "Activity not found." } },
      ),
    );
    return;
  }
  if (pathname === "/api/companies" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body);
      const company = {
        ...companies[0],
        id: `fixture-${companies.length}`,
        name: input.name,
        organizationNumber: input.organizationNumber || null,
        industry: input.industry || null,
        lifecycleStatus: input.lifecycleStatus,
        updatedAt: new Date().toISOString(),
      };
      companies.push(company);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(company));
    });
    return;
  }
  if (pathname === "/api/tasks/meta" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        members: [{ id: "usr_northstar_owner", name: "Morgan Lee" }],
        timezone: "UTC",
      }),
    );
    return;
  }
  if (pathname === "/api/tasks" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        items: tasks,
        page: 1,
        pageSize: 20,
        total: tasks.length,
        totalPages: 1,
        timezone: "UTC",
      }),
    );
    return;
  }
  if (pathname === "/api/tasks" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body),
        task = {
          ...tasks[0],
          id: `fixture-task-${tasks.length}`,
          title: input.title,
          dueAt: input.dueAt,
          priority: input.priority,
          dueState: "upcoming",
        };
      tasks.push(task);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(task));
    });
    return;
  }
  if (
    pathname.match(/^\/api\/tasks\/[^/]+\/(complete|reopen)$/) &&
    request.method === "POST"
  ) {
    const item = tasks.find((task) => pathname.includes(task.id));
    if (item) {
      item.status = pathname.endsWith("complete") ? "completed" : "open";
      item.dueState = item.status === "completed" ? "completed" : "overdue";
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(item));
    return;
  }
  if (pathname === "/api/search" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        query: "Acme",
        total: 4,
        groups: {
          companies: [
            {
              id: "fixture-company",
              name: "Acme Nordic AB",
              context: "Manufacturing",
            },
          ],
          contacts: [
            {
              id: "fixture-contact",
              name: "Alex Acme",
              context: "Acme Nordic AB",
            },
          ],
          deals: [
            {
              id: "fixture-deal",
              name: "Acme renewal",
              context: "Acme Nordic AB",
            },
          ],
          tasks: [
            {
              id: "fixture-task",
              name: "Call Acme",
              context: "2026-08-09T09:00:00Z",
            },
          ],
        },
      }),
    );
    return;
  }
  if (pathname === "/api/search/views" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ items: savedViews }));
    return;
  }
  if (pathname === "/api/search/views" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const input = JSON.parse(body),
        view = { id: `view-${savedViews.length}`, version: 1, ...input };
      savedViews.push(view);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(view));
    });
    return;
  }
  if (
    pathname.startsWith("/api/search/views/") &&
    request.method === "DELETE"
  ) {
    const id = pathname.split("/").at(-1),
      index = savedViews.findIndex((view) => view.id === id);
    if (index >= 0) savedViews.splice(index, 1);
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname === "/api/contacts/contact_fixture") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        contact: {
          id: "contact_fixture",
          firstName: "Avery",
          lastName: "Stone",
          name: "Avery Stone",
          email: "avery@example.test",
          phone: "+46 70 123 45 67",
          jobTitle: "Buyer",
          status: "active",
          tags: ["vip"],
          communicationPreference: "email",
          company: { id: "company_fixture", name: "Acme Nordic AB" },
          owner: { id: "usr_northstar_owner", name: "Northstar Owner" },
          archivedAt: null,
          version: 1,
        },
        activities: [],
        deals: [],
        tasks: [],
        history: [],
        warnings: [],
      }),
    );
    return;
  }
  if (
    pathname === "/workspace" ||
    pathname === "/contacts" ||
    pathname === "/tasks" ||
    pathname === "/deals" ||
    pathname === "/imports" ||
    pathname === "/activities" ||
    pathname.startsWith("/assets/")
  ) {
    const relative =
      pathname === "/workspace" ||
      pathname === "/contacts" ||
      pathname === "/tasks" ||
      pathname === "/deals" ||
      pathname === "/imports" ||
      pathname === "/activities"
        ? "index.html"
        : normalize(pathname).replace(/^\/+/, "");
    try {
      const file = join(clientRoot, relative);
      const body = readFileSync(file);
      response.writeHead(200, {
        "content-type":
          contentTypes[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
server.listen(port, host, () =>
  console.log(`fixture browser server listening on http://${host}:${port}`),
);
const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
