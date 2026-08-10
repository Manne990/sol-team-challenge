import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase, migrate } from "../scripts/database.mjs";

const temporaryDatabase = () => {
  const directory = mkdtempSync(join(tmpdir(), "northstar-db-"));
  return { directory, path: join(directory, "test.sqlite") };
};

test("migrations are repeatable and create the complete schema", () => {
  const fixture = temporaryDatabase();
  try {
    const db = openDatabase(fixture.path);
    migrate(db);
    migrate(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((x) => x.name);
    for (const name of [
      "organizations",
      "users",
      "memberships",
      "sessions",
      "companies",
      "contacts",
      "activities",
      "deals",
      "pipeline_stages",
      "tasks",
      "notifications",
      "saved_views",
      "imports",
      "merge_redirects",
      "audit_events",
    ])
      assert.ok(tables.includes(name), name);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM schema_migrations").get().n,
      1,
    );
    db.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("composite foreign keys reject cross-organization relationships without side effects", () => {
  const fixture = temporaryDatabase();
  try {
    const db = openDatabase(fixture.path);
    migrate(db);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run("organization_a", "A", "a", now, now);
    db.prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run("organization_b", "B", "b", now, now);
    db.prepare(
      "INSERT INTO companies(id,organization_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run("company_org_a", "organization_a", "A Co", now, now);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO contacts(id,organization_id,company_id,first_name,last_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            "contact_org_b",
            "organization_b",
            "company_org_a",
            "Foreign",
            "Contact",
            now,
            now,
          ),
      /FOREIGN KEY/,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM contacts").get().n, 0);
    db.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("transactions roll back atomically and committed data survives restart", () => {
  const fixture = temporaryDatabase();
  try {
    let db = openDatabase(fixture.path);
    migrate(db);
    const now = new Date().toISOString();
    db.exec("BEGIN");
    db.prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run("organization_rollback", "Rollback", "rollback", now, now);
    db.exec("ROLLBACK");
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM organizations").get().n,
      0,
    );
    db.prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run("organization_durable", "Durable", "durable", now, now);
    db.close();
    db = openDatabase(fixture.path);
    assert.equal(
      db
        .prepare("SELECT name FROM organizations WHERE id=?")
        .get("organization_durable").name,
      "Durable",
    );
    db.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
