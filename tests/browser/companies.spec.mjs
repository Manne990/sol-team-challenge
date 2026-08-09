import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const company = {
  id: "cmp-browser", name: "Acme Nordic AB", organizationNumber: "SE-559001", externalReference: "EXT-1",
  website: "https://acme.example", phone: "+46 8 1", industry: "Manufacturing", size: "large", address: { city: "Stockholm" },
  lifecycleStatus: "customer", owner: { id: "membership-owner", name: "Northstar Owner" }, tags: ["priority"], description: "Key account",
  createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-09T10:00:00.000Z", archivedAt: null, version: 1,
};

async function session(page, role="owner") { await page.route("**/api/auth/session", async route=>{ if(route.request().method()!=="GET") return route.continue(); await route.fulfill({contentType:"application/json",body:JSON.stringify({user:{id:`user-${role}`,membershipId:`membership-${role}`,email:`${role}@northstar.test`,name:"Northstar Owner",role,organization:{id:"org-northstar",name:"Northstar Demo"},sessionExpiresAt:"2026-08-10T08:00:00.000Z"}})}); }); }
async function companies(page) { await page.route("**/api/companies**", async route=>{ const url=new URL(route.request().url()); if(route.request().method()==="GET"&&url.pathname==="/api/companies") return route.fulfill({contentType:"application/json",body:JSON.stringify({companies:[company],pagination:{page:1,pageSize:20,total:1,totalPages:1}})}); if(route.request().method()==="GET") return route.fulfill({contentType:"application/json",body:JSON.stringify({company:{...company,relatedCounts:{contacts:2,activities:4,deals:1,tasks:3},history:[{action:"company.created",timestamp:company.createdAt,summary:{name:company.name}}]}})}); if(route.request().method()==="POST") return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify({company:{...company,name:"Polar Systems",relatedCounts:{contacts:0,activities:0,deals:0,tasks:0},history:[]}})}); return route.fulfill({status:204}); }); }

test("owner scans, filters, opens, and creates companies accessibly",async({page})=>{await session(page);await companies(page);await page.goto("/workspace");await page.getByRole("link",{name:"Companies"}).click();await expect(page.getByRole("heading",{name:"Companies"})).toBeVisible();await expect(page.getByText("Acme Nordic AB")).toBeVisible();await page.getByRole("button",{name:"Acme Nordic AB"}).click();await expect(page.getByRole("heading",{name:"Connected history"})).toBeVisible();await page.getByRole("button",{name:"New company"}).click();await page.getByLabel("Name *").fill("Polar Systems");await page.getByRole("button",{name:"Save company"}).click();await expect(page.getByText("Company created.")).toBeVisible();expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);});

test("viewer can inspect companies but has no mutation controls",async({page})=>{await session(page,"viewer");await companies(page);await page.goto("/workspace");await page.getByRole("link",{name:"Companies"}).click();await expect(page.getByText("Acme Nordic AB")).toBeVisible();await expect(page.getByRole("button",{name:"New company"})).toHaveCount(0);});
