import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SqliteAuthStore, type SqliteDatabase } from "./sqlite-store.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
  const now = "2026-08-05T12:00:00.000Z";
  db.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)").run("org-a", "Northstar", "northstar", now, now);
  db.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)").run("org-b", "Outside", "outside", now, now);
  db.prepare("INSERT INTO users(id,email,password_hash,first_name,last_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("user-a", "owner@example.test", "scrypt$seed$86b00bec1f8b87006f733f08d8fdb46d74d6000dac275516fb0cbe59bde09bf262a386c7d8f770ea393e50f32a627f025a4e5d83cc427da1c1d036f559b5c927", "A", "Owner", now, now);
  db.prepare("INSERT INTO users(id,email,password_hash,first_name,last_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("user-b", "outside@example.test", "unused", "B", "Owner", now, now);
  const member = db.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)");
  member.run("member-a", "org-a", "user-a", "owner", "active", now, now);
  member.run("member-b", "org-b", "user-b", "owner", "active", now, now);
  return { db, store: new SqliteAuthStore(db as unknown as SqliteDatabase) };
}

describe("SQLite authorization boundaries", () => {
  it("does not reveal or mutate a foreign membership", async () => {
    const { db, store } = fixture();
    const before = db.prepare("SELECT role,status,version FROM memberships WHERE id='member-b'").get();
    await expect(store.changeMemberRole({ organizationId: "org-a", memberId: "member-b", role: "viewer", actorId: "user-a" }))
      .resolves.toBe("not_found");
    expect(db.prepare("SELECT role,status,version FROM memberships WHERE id='member-b'").get()).toEqual(before);
  });

  it("atomically protects the last owner and revokes removed member sessions", async () => {
    const { db, store } = fixture();
    await expect(store.revokeMember({ organizationId: "org-a", memberId: "member-a", actorId: "user-a" })).resolves.toBe("last_owner");
    expect(db.prepare("SELECT status FROM memberships WHERE id='member-a'").get()).toEqual({ status: "active" });
  });

  it("rejects expired and revoked sessions", async () => {
    const { store } = fixture();
    await store.createSession({ id: "session-a", tokenHash: "hash-a", userId: "user-a", organizationId: "org-a", expiresAt: "2026-08-06T00:00:00Z" });
    await expect(store.findSession("hash-a", "2026-08-05T20:00:00Z")).resolves.toMatchObject({ role: "owner", organization: { id: "org-a" } });
    await expect(store.findSession("hash-a", "2026-08-07T00:00:00Z")).resolves.toBeUndefined();
    await store.revokeSession("hash-a", "2026-08-05T21:00:00Z");
    await expect(store.findSession("hash-a", "2026-08-05T22:00:00Z")).resolves.toBeUndefined();
  });
});
