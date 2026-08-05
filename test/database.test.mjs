import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { migrate, openDatabase, transaction } from "../src/db/database.mjs";
import { seedDatabase } from "../src/db/seed.mjs";

function isolated() {
  const directory=mkdtempSync(join(tmpdir(),"northstar-db-"));
  const path=join(directory,"test.sqlite");
  const db=openDatabase(path); migrate(db);
  return {db,path,close(){ db.close(); rmSync(directory,{recursive:true,force:true}); }};
}
test("forward migration creates the complete domain schema", () => {
  const fixture=isolated();
  try {
    const names=fixture.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
    for (const required of ["organizations","sessions","companies","contacts","activities","deals","pipeline_stages","tasks","notifications","saved_views","imports","merge_redirects","audit_events"]) assert(names.includes(required),required);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM schema_migrations").get().n,1);
    migrate(fixture.db);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM schema_migrations").get().n,1);
  } finally { fixture.close(); }
});
test("seed is deterministic, idempotent, and has frozen isolated accounts and volume", () => {
  const fixture=isolated();
  try {
    seedDatabase(fixture.db); seedDatabase(fixture.db);
    assert.deepEqual(fixture.db.prepare("SELECT email,role FROM users JOIN memberships ON users.id=memberships.user_id ORDER BY email").all().map(row=>({...row})),[
      {email:"member@northstar.test",role:"member"},{email:"other-owner@outside.test",role:"owner"},{email:"owner@northstar.test",role:"owner"},{email:"viewer@northstar.test",role:"viewer"},
    ]);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM companies WHERE organization_id='org_northstar'").get().n,30);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM contacts WHERE organization_id='org_northstar'").get().n,36);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM activities").get().n,40);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM deals").get().n,20);
    assert.equal(fixture.db.prepare("SELECT count(*) n FROM tasks").get().n,28);
  } finally { fixture.close(); }
});
test("composite foreign keys reject cross-organization relationships", () => {
  const fixture=isolated();
  try {
    seedDatabase(fixture.db);
    assert.throws(()=>fixture.db.prepare("UPDATE companies SET owner_membership_id='mem_outside' WHERE id='cmp_0001_northstar'").run(),/FOREIGN KEY/);
    assert.throws(()=>fixture.db.prepare("INSERT INTO deals(id,organization_id,company_id,owner_membership_id,stage_id,name,amount_minor,currency,probability,status,created_at,updated_at) VALUES('bad','org_outside','cmp_0001_northstar','mem_outside','stage_outside','Leak',1,'SEK',1,'open',?,?)").run("2026-01-01T00:00:00Z","2026-01-01T00:00:00Z"),/FOREIGN KEY/);
  } finally { fixture.close(); }
});
test("transactions roll back atomically and audit events are immutable", () => {
  const fixture=isolated();
  try {
    seedDatabase(fixture.db);
    assert.throws(()=>transaction(fixture.db,()=>{ fixture.db.prepare("UPDATE companies SET name='Should roll back' WHERE id='cmp_0001_northstar'").run(); throw new Error("interrupt"); }),/interrupt/);
    assert.equal(fixture.db.prepare("SELECT name FROM companies WHERE id='cmp_0001_northstar'").get().name,"Northstar Account 1");
    assert.throws(()=>fixture.db.prepare("DELETE FROM audit_events WHERE id='audit_seed'").run(),/immutable/);
  } finally { fixture.close(); }
});
test("committed state survives closing and reopening SQLite", () => {
  const fixture=isolated(); seedDatabase(fixture.db);
  fixture.db.prepare("UPDATE companies SET description='persisted',version=version+1 WHERE id='cmp_0002_northstar'").run(); fixture.db.close();
  const reopened=openDatabase(fixture.path);
  try { assert.deepEqual({...reopened.prepare("SELECT description,version FROM companies WHERE id='cmp_0002_northstar'").get()},{description:"persisted",version:2}); }
  finally { reopened.close(); rmSync(dirname(fixture.path),{recursive:true,force:true}); }
});
