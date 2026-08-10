import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { AuthError, AuthService } from "../src/auth/service.js";
import type {
  AuthRepository,
  Membership,
  SessionRecord,
  UserAccount,
} from "../src/auth/types.js";

class MemoryRepository implements AuthRepository {
  users: UserAccount[] = [];
  memberships: Membership[] = [];
  sessions: SessionRecord[] = [];
  async findUserByNormalizedEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async findActiveMemberships(userId: string) {
    return this.memberships.filter((m) => m.userId === userId && !m.revokedAt);
  }
  async findSessionByTokenHash(hash: string) {
    return this.sessions.find((s) => s.tokenHash === hash) ?? null;
  }
  async findMembership(id: string) {
    return this.memberships.find((m) => m.id === id) ?? null;
  }
  async insertSession(session: SessionRecord) {
    this.sessions.push(session);
  }
  async revokeSession(id: string, at: string) {
    this.sessions.find((s) => s.id === id)!.revokedAt = at;
  }
  async revokeSessionsForMembership(id: string, at: string) {
    this.sessions
      .filter((s) => s.membershipId === id && !s.revokedAt)
      .forEach((s) => {
        s.revokedAt = at;
      });
  }
  async countActiveOwners(org: string) {
    return this.memberships.filter(
      (m) => m.organizationId === org && m.role === "owner" && !m.revokedAt,
    ).length;
  }
  async insertMembership(m: Membership) {
    this.memberships.push(m);
  }
  async updateMembershipRole(id: string, role: Membership["role"]) {
    this.memberships.find((m) => m.id === id)!.role = role;
  }
  async revokeMembership(id: string, at: string) {
    this.memberships.find((m) => m.id === id)!.revokedAt = at;
  }
}

async function fixture() {
  const repository = new MemoryRepository();
  repository.users.push(
    {
      id: "owner",
      email: "owner@northstar.test",
      displayName: "Owner",
      passwordHash: await bcrypt.hash("OwnerPass!2026", 4),
      disabledAt: null,
    },
    {
      id: "member",
      email: "member@northstar.test",
      displayName: "Member",
      passwordHash: await bcrypt.hash("MemberPass!2026", 4),
      disabledAt: null,
    },
  );
  repository.memberships.push(
    {
      id: "owner-membership",
      organizationId: "northstar",
      userId: "owner",
      role: "owner",
      revokedAt: null,
    },
    {
      id: "member-membership",
      organizationId: "northstar",
      userId: "member",
      role: "member",
      revokedAt: null,
    },
    {
      id: "foreign-membership",
      organizationId: "outside",
      userId: "member",
      role: "owner",
      revokedAt: null,
    },
  );
  return {
    repository,
    service: new AuthService(repository, {
      now: () => new Date("2026-08-10T10:00:00Z"),
      sessionTtlMs: 60_000,
    }),
  };
}
async function rejectsCode(promise: Promise<unknown>, code: AuthError["code"]) {
  await assert.rejects(
    promise,
    (e: unknown) => e instanceof AuthError && e.code === code,
  );
}

test("sign-in binds the session to an organization and stores no bearer token", async () => {
  const { repository, service } = await fixture();
  const signedIn = await service.signIn(
    " OWNER@NORTHSTAR.TEST ",
    "OwnerPass!2026",
    "northstar",
  );
  assert.equal(signedIn.principal.organizationId, "northstar");
  assert.equal(
    repository.sessions[0]!.tokenHash.includes(signedIn.token),
    false,
  );
  assert.equal((await service.authenticate(signedIn.token)).role, "owner");
});

test("unknown user and bad password have an identical generic error", async () => {
  const { service } = await fixture();
  const messages: string[] = [];
  for (const attempt of [
    () => service.signIn("missing@test.invalid", "OwnerPass!2026", "northstar"),
    () => service.signIn("owner@northstar.test", "bad", "northstar"),
  ]) {
    await assert.rejects(attempt(), (e: unknown) => {
      if (e instanceof Error) messages.push(e.message);
      return e instanceof AuthError && e.code === "invalid_credentials";
    });
  }
  assert.equal(new Set(messages).size, 1);
});

test("logout and expiry revoke authentication", async () => {
  const { service } = await fixture();
  const signedIn = await service.signIn(
    "owner@northstar.test",
    "OwnerPass!2026",
    "northstar",
  );
  await service.logout(signedIn.token);
  await rejectsCode(service.authenticate(signedIn.token), "unauthenticated");
  const active = await fixture();
  const expiring = await active.service.signIn(
    "owner@northstar.test",
    "OwnerPass!2026",
    "northstar",
  );
  await rejectsCode(
    new AuthService(active.repository, {
      now: () => new Date("2026-08-10T10:02:00Z"),
    }).authenticate(expiring.token),
    "unauthenticated",
  );
});

test("viewer mutation and member administration are forbidden", async () => {
  const { service } = await fixture();
  assert.throws(
    () =>
      service.requireMutation({
        sessionId: "s",
        userId: "u",
        membershipId: "m",
        organizationId: "o",
        role: "viewer",
        expiresAt: "x",
      }),
    AuthError,
  );
  await rejectsCode(
    service.addMembership(
      {
        sessionId: "s",
        userId: "u",
        membershipId: "m",
        organizationId: "o",
        role: "member",
        expiresAt: "x",
      },
      "u2",
      "viewer",
    ),
    "forbidden",
  );
});

test("foreign member access matches missing and leaves persisted state unchanged", async () => {
  const { repository, service } = await fixture();
  const owner = await service.signIn(
    "owner@northstar.test",
    "OwnerPass!2026",
    "northstar",
  );
  const before = structuredClone(repository.memberships);
  await rejectsCode(
    service.revokeMembership(owner.principal, "foreign-membership"),
    "unauthenticated",
  );
  assert.deepEqual(repository.memberships, before);
  await rejectsCode(
    service.revokeMembership(owner.principal, "missing"),
    "unauthenticated",
  );
});

test("last owner is retained and role changes revoke active sessions", async () => {
  const { service } = await fixture();
  const owner = await service.signIn(
    "owner@northstar.test",
    "OwnerPass!2026",
    "northstar",
  );
  await rejectsCode(
    service.changeRole(owner.principal, "owner-membership", "member"),
    "conflict",
  );
  const member = await service.signIn(
    "member@northstar.test",
    "MemberPass!2026",
    "northstar",
  );
  await service.changeRole(owner.principal, "member-membership", "viewer");
  await rejectsCode(service.authenticate(member.token), "unauthenticated");
});
