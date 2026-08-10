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
    pathname.startsWith("/assets/")
  ) {
    const relative =
      pathname === "/workspace" || pathname === "/contacts"
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
