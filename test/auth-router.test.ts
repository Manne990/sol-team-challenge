import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import express from "express";
import { createAuthRouter } from "../src/auth/router.js";

async function serverFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(resolve("db/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    database.exec(readFileSync(resolve("db/migrations", file), "utf8"));
  const now = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
    )
    .run("organization_one", "One", "one", now, now);
  database
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
  database
    .prepare(
      "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
    )
    .run("organization_one", "user_owner_01", "owner", now);
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(database, false));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolveReady) =>
    server.once("listening", resolveReady),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    database,
    origin,
    close: () =>
      new Promise<void>((resolveClose, reject) =>
        server.close((error) =>
          error ? reject(error) : (database.close(), resolveClose()),
        ),
      ),
  };
}

test("HTTP sign-in, session lookup, and logout use a protected cookie", async () => {
  const fixture = await serverFixture();
  try {
    const signIn = await fetch(`${fixture.origin}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.origin },
      body: JSON.stringify({
        email: "owner@example.test",
        password: "a-secure-password",
        organizationId: "organization_one",
      }),
    });
    assert.equal(signIn.status, 201);
    const cookie = signIn.headers.get("set-cookie");
    assert.match(cookie ?? "", /HttpOnly/);
    assert.equal(
      (
        await fetch(`${fixture.origin}/api/auth/session`, {
          headers: { cookie: cookie! },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${fixture.origin}/api/auth/session`, {
          method: "DELETE",
          headers: { cookie: cookie!, origin: fixture.origin },
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await fetch(`${fixture.origin}/api/auth/session`, {
          headers: { cookie: cookie! },
        })
      ).status,
      401,
    );
  } finally {
    await fixture.close();
  }
});

test("sign-in rejects foreign origins and keeps credential errors generic", async () => {
  const fixture = await serverFixture();
  try {
    const rejected = await fetch(`${fixture.origin}/api/auth/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.test",
      },
      body: "{}",
    });
    assert.equal(rejected.status, 403);
    const messages = [] as string[];
    for (const body of [
      {
        email: "missing@example.test",
        password: "a-secure-password",
        organizationId: "organization_one",
      },
      {
        email: "owner@example.test",
        password: "wrong",
        organizationId: "organization_one",
      },
    ]) {
      const response = await fetch(`${fixture.origin}/api/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: fixture.origin },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 401);
      messages.push(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
    }
    assert.equal(new Set(messages).size, 1);
  } finally {
    await fixture.close();
  }
});
