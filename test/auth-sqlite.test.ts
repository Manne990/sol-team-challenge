import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { AuthService } from "../src/auth/service.js";
import { SqliteAuthRepository } from "../src/auth/sqlite-repository.js";

function databaseFixture() {
  const directory = mkdtempSync(join(tmpdir(), "northstar-auth-"));
  const path = join(directory, "auth.sqlite");
  const open = () => {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys=ON");
    return db;
  };
  const db = open();
  for (const file of readdirSync(resolve("db/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  return { directory, path, db, open };
}

test("a persisted session authenticates after the database is reopened", async () => {
  const fixture = databaseFixture();
  try {
    const now = "2026-08-10T10:00:00.000Z";
    fixture.db
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .run("organization_one", "One", "one", now, now);
    fixture.db
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        "user_owner_01",
        "owner@example.test",
        await bcrypt.hash("a-secure-password", 4),
        "Owner",
        now,
        now,
      );
    fixture.db
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
      )
      .run("organization_one", "user_owner_01", "owner", now);
    const service = new AuthService(new SqliteAuthRepository(fixture.db), {
      now: () => new Date(now),
    });
    const signedIn = await service.signIn(
      "owner@example.test",
      "a-secure-password",
      "organization_one",
    );
    fixture.db.close();
    const reopened = fixture.open();
    assert.equal(
      (
        await new AuthService(new SqliteAuthRepository(reopened), {
          now: () => new Date("2026-08-10T10:01:00Z"),
        }).authenticate(signedIn.token)
      ).userId,
      "user_owner_01",
    );
    reopened.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("database invariant blocks racing removal of the final owner", () => {
  const fixture = databaseFixture();
  try {
    const now = new Date().toISOString();
    fixture.db
      .prepare(
        "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .run("organization_one", "One", "one", now, now);
    fixture.db
      .prepare(
        "INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run("user_owner_01", "owner@example.test", "hash", "Owner", now, now);
    fixture.db
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
      )
      .run("organization_one", "user_owner_01", "owner", now);
    assert.throws(
      () =>
        fixture.db
          .prepare(
            "UPDATE memberships SET revoked_at=? WHERE organization_id=? AND user_id=?",
          )
          .run(now, "organization_one", "user_owner_01"),
      /retain an owner/,
    );
    assert.equal(
      fixture.db.prepare("SELECT revoked_at FROM memberships").get()!
        .revoked_at,
      null,
    );
    fixture.db.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
