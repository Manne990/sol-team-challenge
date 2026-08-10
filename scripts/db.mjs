import { scryptSync } from "node:crypto";
import { openDatabase, migrate, resetDatabase } from "./database.mjs";

const command = process.argv[2];
if (command === "reset") {
  resetDatabase();
  console.log("database reset and migrations applied");
} else if (command === "seed") {
  const db = openDatabase();
  migrate(db);
  const now = "2026-08-10T08:00:00.000Z";
  const hash = (password, salt) =>
    `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const run = db.prepare.bind(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const org = run(
      "INSERT OR IGNORE INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
    );
    org.run("org_northstar_demo", "Northstar Demo", "northstar-demo", now, now);
    org.run("org_outside_demo", "Outside Demo", "outside-demo", now, now);
    const user = run(
      "INSERT OR IGNORE INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    );
    const people = [
      [
        "usr_northstar_owner",
        "owner@northstar.test",
        "OwnerPass!2026",
        "Northstar Owner",
        "salt-owner",
      ],
      [
        "usr_northstar_member",
        "member@northstar.test",
        "MemberPass!2026",
        "Northstar Member",
        "salt-member",
      ],
      [
        "usr_northstar_viewer",
        "viewer@northstar.test",
        "ViewerPass!2026",
        "Northstar Viewer",
        "salt-viewer",
      ],
      [
        "usr_outside_owner",
        "other-owner@outside.test",
        "OutsidePass!2026",
        "Outside Owner",
        "salt-outside",
      ],
    ];
    for (const [id, email, password, name, salt] of people)
      user.run(id, email, hash(password, salt), name, now, now);
    const membership = run(
      "INSERT OR IGNORE INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
    );
    membership.run("org_northstar_demo", "usr_northstar_owner", "owner", now);
    membership.run("org_northstar_demo", "usr_northstar_member", "member", now);
    membership.run("org_northstar_demo", "usr_northstar_viewer", "viewer", now);
    membership.run("org_outside_demo", "usr_outside_owner", "owner", now);
    const stage = run(
      "INSERT OR IGNORE INTO pipeline_stages(id,organization_id,name,position,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    );
    for (const [i, name, color] of [
      [0, "Qualification", "#2563eb"],
      [1, "Proposal", "#7c3aed"],
      [2, "Negotiation", "#d97706"],
      [3, "Closed", "#059669"],
    ])
      stage.run(
        `stage_northstar_${i}`,
        "org_northstar_demo",
        name,
        i,
        color,
        now,
        now,
      );
    stage.run(
      "stage_outside_0",
      "org_outside_demo",
      "Qualification",
      0,
      "#2563eb",
      now,
      now,
    );
    const company = run(
      "INSERT OR IGNORE INTO companies(id,organization_id,name,organization_number,external_reference,website,phone,industry,size,address,lifecycle_status,owner_id,tags_json,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const contact = run(
      "INSERT OR IGNORE INTO contacts(id,organization_id,company_id,first_name,last_name,email,phone,job_title,owner_id,status,tags_json,communication_preference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const deal = run(
      "INSERT OR IGNORE INTO deals(id,organization_id,name,company_id,owner_id,amount_minor,currency,expected_close_date,probability,stage_id,status,loss_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const task = run(
      "INSERT OR IGNORE INTO tasks(id,organization_id,title,description,assignee_id,due_at,priority,status,company_id,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const activity = run(
      "INSERT OR IGNORE INTO activities(id,organization_id,type,subject,body,occurred_at,creator_id,creator_name_snapshot,company_id,company_name_snapshot,contact_id,contact_name_snapshot,deal_id,deal_name_snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (let i = 1; i <= 32; i++) {
      const n = String(i).padStart(2, "0"),
        cid = `cmp_northstar_${n}`,
        co = `Account ${n}`;
      company.run(
        cid,
        "org_northstar_demo",
        co,
        `SE556000-${String(1000 + i)}`,
        `NS-${n}`,
        `https://account${i}.example`,
        `+46 8 555 ${n}`,
        ["Technology", "Retail", "Services"][i % 3],
        ["small", "medium", "large"][i % 3],
        `${i} Market Street`,
        ["lead", "prospect", "customer"][i % 3],
        i % 2 ? "usr_northstar_owner" : "usr_northstar_member",
        JSON.stringify(i % 4 === 0 ? ["priority", "renewal"] : ["standard"]),
        `Seeded account ${i}`,
        now,
        now,
      );
      const contactId = `con_northstar_${n}`;
      contact.run(
        contactId,
        "org_northstar_demo",
        cid,
        `Contact${n}`,
        "Example",
        `contact${i}@example.test`,
        `+46 70 100 ${n}`,
        "Stakeholder",
        i % 2 ? "usr_northstar_owner" : "usr_northstar_member",
        "active",
        JSON.stringify([i % 2 ? "decision-maker" : "champion"]),
        "email",
        now,
        now,
      );
      const did = `deal_northstar_${n}`,
        status = i % 9 === 0 ? "lost" : i % 7 === 0 ? "won" : "open";
      deal.run(
        did,
        "org_northstar_demo",
        `${co} expansion`,
        cid,
        "usr_northstar_owner",
        100000 * i,
        "SEK",
        `2026-${String(8 + (i % 4)).padStart(2, "0")}-${String(10 + (i % 18)).padStart(2, "0")}`,
        Math.min(100, ((i % 4) + 1) * 20),
        `stage_northstar_${i % 4}`,
        status,
        status === "lost" ? "Budget postponed" : null,
        now,
        now,
      );
      const completed = i % 6 === 0;
      task.run(
        `task_northstar_${n}`,
        "org_northstar_demo",
        `Follow up ${co}`,
        "Deterministic seeded task",
        i % 2 ? "usr_northstar_owner" : "usr_northstar_member",
        `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T09:00:00.000Z`,
        i % 5 === 0 ? "high" : "normal",
        completed ? "completed" : "open",
        cid,
        now,
        now,
        completed ? now : null,
      );
      activity.run(
        `act_northstar_${n}`,
        "org_northstar_demo",
        ["call", "email", "meeting", "note"][i % 4],
        `Touchpoint with ${co}`,
        `Historical interaction ${i}`,
        `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`,
        "usr_northstar_member",
        "Northstar Member",
        cid,
        co,
        contactId,
        `Contact${n} Example`,
        did,
        `${co} expansion`,
        now,
        now,
      );
    }
    company.run(
      "cmp_outside_01",
      "org_outside_demo",
      "Account 01",
      "OUT-0001",
      "OUT-01",
      "https://outside.example",
      null,
      "Technology",
      "small",
      "1 Outside Way",
      "customer",
      "usr_outside_owner",
      "[]",
      "Tenant-isolation fixture",
      now,
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.close();
  console.log("deterministic seed applied");
} else throw new Error("Usage: node scripts/db.mjs reset|seed");
