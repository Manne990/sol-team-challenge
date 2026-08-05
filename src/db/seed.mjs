import { scryptSync } from "node:crypto";

const NOW = "2026-08-05T12:00:00.000Z";
const id = (kind, n) => `${kind}_${String(n).padStart(4, "0")}_northstar`;
const hashPassword = (password, salt) =>
  `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;

export function seedDatabase(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const org = db.prepare(
      "INSERT OR IGNORE INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
    );
    org.run("org_northstar", "Northstar Demo", "northstar-demo", NOW, NOW);
    org.run("org_outside", "Outside Demo", "outside-demo", NOW, NOW);
    const user = db.prepare(
      "INSERT OR IGNORE INTO users(id,email,password_hash,first_name,last_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    );
    const accounts = [
      [
        "usr_owner",
        "owner@northstar.test",
        "OwnerPass!2026",
        "Avery",
        "Owner",
        "seed-owner",
      ],
      [
        "usr_member",
        "member@northstar.test",
        "MemberPass!2026",
        "Morgan",
        "Member",
        "seed-member",
      ],
      [
        "usr_viewer",
        "viewer@northstar.test",
        "ViewerPass!2026",
        "Vera",
        "Viewer",
        "seed-viewer",
      ],
      [
        "usr_outside",
        "other-owner@outside.test",
        "OutsidePass!2026",
        "Otto",
        "Outside",
        "seed-outside",
      ],
    ];
    for (const [uid, email, password, first, last, salt] of accounts)
      user.run(uid, email, hashPassword(password, salt), first, last, NOW, NOW);
    const membership = db.prepare(
      "INSERT OR IGNORE INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    );
    membership.run(
      "mem_owner",
      "org_northstar",
      "usr_owner",
      "owner",
      "active",
      NOW,
      NOW,
    );
    membership.run(
      "mem_member",
      "org_northstar",
      "usr_member",
      "member",
      "active",
      NOW,
      NOW,
    );
    membership.run(
      "mem_viewer",
      "org_northstar",
      "usr_viewer",
      "viewer",
      "active",
      NOW,
      NOW,
    );
    membership.run(
      "mem_outside",
      "org_outside",
      "usr_outside",
      "owner",
      "active",
      NOW,
      NOW,
    );
    const stage = db.prepare(
      "INSERT OR IGNORE INTO pipeline_stages(id,organization_id,name,position,color,is_won,is_lost,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    [
      ["lead", 0, "#64748b", 0, 0],
      ["qualified", 1, "#2563eb", 0, 0],
      ["proposal", 2, "#7c3aed", 0, 0],
      ["won", 3, "#15803d", 1, 0],
      ["lost", 4, "#b91c1c", 0, 1],
    ].forEach(([name, pos, color, won, lost]) =>
      stage.run(
        `stage_${name}`,
        "org_northstar",
        name[0].toUpperCase() + name.slice(1),
        pos,
        color,
        won,
        lost,
        NOW,
        NOW,
      ),
    );
    stage.run(
      "stage_outside",
      "org_outside",
      "Open",
      0,
      "#2563eb",
      0,
      0,
      NOW,
      NOW,
    );
    const company = db.prepare(
      "INSERT OR IGNORE INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address_json,lifecycle_status,owner_membership_id,tags_json,description,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const industries = [
      "Technology",
      "Manufacturing",
      "Healthcare",
      "Retail",
      "Services",
    ];
    for (let n = 1; n <= 30; n++)
      company.run(
        id("cmp", n),
        "org_northstar",
        `${n % 7 === 0 ? "Acme" : "Northstar Account"} ${n}`,
        `SE-${5590000000 + n}`,
        `EXT-${n}`,
        `https://account-${n}.example.test`,
        `+46 8 555 ${String(n).padStart(4, "0")}`,
        industries[n % industries.length],
        ["small", "medium", "large"][n % 3],
        JSON.stringify({ city: n % 2 ? "Stockholm" : "Malmö", country: "SE" }),
        n % 5 === 0 ? "prospect" : "customer",
        n % 3 === 0 ? "mem_member" : "mem_owner",
        JSON.stringify(n % 2 ? ["priority"] : ["renewal", "partner"]),
        `Seed account ${n}`,
        new Date(Date.parse(NOW) - n * 86400000 * 5).toISOString(),
        NOW,
        n === 30 ? NOW : null,
      );
    company.run(
      "cmp_outside",
      "org_outside",
      "Outside Secret AB",
      "OUT-1",
      "OUTSIDE-1",
      null,
      null,
      "Private",
      "small",
      "{}",
      "customer",
      "mem_outside",
      "[]",
      "Must remain tenant isolated",
      NOW,
      NOW,
      null,
    );
    const contact = db.prepare(
      "INSERT OR IGNORE INTO contacts(id,organization_id,company_id,first_name,last_name,email,phone,job_title,owner_membership_id,status,tags_json,communication_preference,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (let n = 1; n <= 36; n++)
      contact.run(
        id("con", n),
        "org_northstar",
        n % 6 === 0 ? null : id("cmp", ((n - 1) % 30) + 1),
        `Contact${n}`,
        n % 8 === 0 ? "Andersson" : `Person${n}`,
        `contact${n}@example.test`,
        `+46 70 100 ${String(n).padStart(4, "0")}`,
        n % 3 === 0 ? "Decision maker" : "Stakeholder",
        n % 2 ? "mem_owner" : "mem_member",
        n % 9 === 0 ? "lead" : "active",
        JSON.stringify(n % 4 === 0 ? ["vip"] : []),
        n % 5 === 0 ? "phone" : "email",
        NOW,
        NOW,
      );
    const deal = db.prepare(
      "INSERT OR IGNORE INTO deals(id,organization_id,company_id,owner_membership_id,stage_id,name,amount_minor,currency,expected_close_date,probability,status,loss_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const stageNames = ["lead", "qualified", "proposal", "won", "lost"];
    for (let n = 1; n <= 20; n++) {
      const s = stageNames[(n - 1) % 5];
      deal.run(
        id("deal", n),
        "org_northstar",
        id("cmp", n),
        n % 2 ? "mem_owner" : "mem_member",
        `stage_${s}`,
        `Opportunity ${n}`,
        n * 125000,
        n % 6 === 0 ? "USD" : "SEK",
        new Date(Date.parse(NOW) + (n - 10) * 86400000)
          .toISOString()
          .slice(0, 10),
        [10, 35, 70, 100, 0][(n - 1) % 5],
        s === "won" ? "won" : s === "lost" ? "lost" : "open",
        s === "lost" ? "Budget" : null,
        NOW,
        NOW,
      );
    }
    const dealContact = db.prepare(
      "INSERT OR IGNORE INTO deal_contacts(organization_id,deal_id,contact_id,created_at) VALUES(?,?,?,?)",
    );
    for (let n = 1; n <= 20; n++)
      dealContact.run("org_northstar", id("deal", n), id("con", n), NOW);
    const task = db.prepare(
      "INSERT OR IGNORE INTO tasks(id,organization_id,title,description,assignee_membership_id,due_at,priority,status,company_id,contact_id,deal_id,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (let n = 1; n <= 28; n++) {
      const complete = n % 7 === 0;
      task.run(
        id("task", n),
        "org_northstar",
        `Follow up ${n}`,
        `Seed follow-up task ${n}`,
        n % 2 ? "mem_owner" : "mem_member",
        new Date(Date.parse(NOW) + (n - 12) * 3600000 * 12).toISOString(),
        ["low", "normal", "high", "urgent"][n % 4],
        complete ? "completed" : "open",
        id("cmp", ((n - 1) % 30) + 1),
        id("con", ((n - 1) % 36) + 1),
        n <= 20 ? id("deal", n) : null,
        NOW,
        NOW,
        complete ? NOW : null,
      );
    }
    const activity = db.prepare(
      "INSERT OR IGNORE INTO activities(id,organization_id,type,subject,body,occurred_at,creator_membership_id,creator_label,company_id,contact_id,deal_id,follow_up_task_id,related_label_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const types = ["call", "email", "meeting", "note", "status_change"];
    for (let n = 1; n <= 40; n++)
      activity.run(
        id("act", n),
        "org_northstar",
        types[n % 5],
        `Historical interaction ${n}`,
        `Durable summary ${n}`,
        new Date(Date.parse(NOW) - n * 3600000 * 18).toISOString(),
        n % 2 ? "mem_owner" : "mem_member",
        n % 2 ? "Avery Owner" : "Morgan Member",
        id("cmp", ((n - 1) % 30) + 1),
        id("con", ((n - 1) % 36) + 1),
        n <= 20 ? id("deal", n) : null,
        n <= 28 && n % 4 === 0 ? id("task", n) : null,
        JSON.stringify({
          company: `Northstar Account ${((n - 1) % 30) + 1}`,
          contact: `Contact${((n - 1) % 36) + 1}`,
        }),
        NOW,
        NOW,
      );
    db.prepare(
      "INSERT OR IGNORE INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "audit_seed",
      "org_northstar",
      "mem_owner",
      "seed.completed",
      "organization",
      "org_northstar",
      "seed-2026",
      JSON.stringify({ companies: 30, contacts: 36 }),
      NOW,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
