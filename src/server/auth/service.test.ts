import { describe, expect, it } from "vitest";
import type { AuthenticatedUser, Role } from "../../shared/auth.js";
import { hashPassword } from "./password.js";
import { AuthError, AuthService } from "./service.js";
import { hashSessionSecret } from "./session.js";
import type { AuthStore } from "./types.js";

class MemoryStore implements AuthStore {
  passwordHash = "";
  sessions = new Map<string, AuthenticatedUser>();
  revoked: string[] = [];
  async findLogin(email: string) {
    if (email !== "owner@northstar.test") return undefined;
    return {
      userId: "user-owner",
      membershipId: "member-owner",
      email,
      name: "Northstar Owner",
      passwordHash: this.passwordHash,
      organizationId: "org-northstar",
      organizationName: "Northstar Demo",
      role: "owner" as const,
    };
  }
  async createSession(input: { tokenHash: string; expiresAt: string }) {
    this.sessions.set(input.tokenHash, {
      id: "user-owner",
      membershipId: "member-owner",
      email: "owner@northstar.test",
      name: "Northstar Owner",
      role: "owner",
      organization: { id: "org-northstar", name: "Northstar Demo" },
      sessionExpiresAt: input.expiresAt,
    });
  }
  async findSession(hash: string) {
    return this.sessions.get(hash);
  }
  async revokeSession(hash: string) {
    this.revoked.push(hash);
    this.sessions.delete(hash);
  }
  async listMembers() {
    return [
      {
        id: "member-owner",
        email: "owner@northstar.test",
        name: "Northstar Owner",
        role: "owner" as const,
      },
    ];
  }
  async createMember() {
    return "conflict" as const;
  }
  async changeMemberRole(_input: {
    organizationId: string;
    memberId: string;
    role: Role;
    actorId: string;
  }) {
    return "last_owner" as const;
  }
  async revokeMember() {
    return "last_owner" as const;
  }
}

const now = () => new Date("2026-08-05T20:00:00.000Z");

describe("AuthService", () => {
  it("normalizes email, verifies Argon2id, and persists only a token hash", async () => {
    const store = new MemoryStore();
    store.passwordHash = await hashPassword("OwnerPass!2026");
    const service = new AuthService(store, now);
    const result = await service.signIn(
      " OWNER@NORTHSTAR.TEST ",
      "OwnerPass!2026",
    );
    expect(result.user.organization.id).toBe("org-northstar");
    expect(result.expiresAt.toISOString()).toBe("2026-08-06T08:00:00.000Z");
    expect(store.sessions.has(result.secret)).toBe(false);
    expect(store.sessions.has(hashSessionSecret(result.secret))).toBe(true);
  });

  it("uses the same public error for unknown users and incorrect passwords", async () => {
    const store = new MemoryStore();
    store.passwordHash = await hashPassword("OwnerPass!2026");
    const service = new AuthService(store, now);
    for (const [email, password] of [
      ["missing@northstar.test", "nope"],
      ["owner@northstar.test", "nope"],
    ]) {
      await expect(service.signIn(email, password)).rejects.toMatchObject({
        status: 401,
        code: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect.",
      });
    }
  });

  it("enforces role permissions and protects the last owner", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store, now);
    const owner: AuthenticatedUser = {
      id: "user-owner",
      membershipId: "member-owner",
      email: "owner@northstar.test",
      name: "Owner",
      role: "owner",
      organization: { id: "org-northstar", name: "Northstar Demo" },
      sessionExpiresAt: "2026-08-06T08:00:00Z",
    };
    await expect(
      service.changeRole(owner, "member-owner", "member"),
    ).rejects.toMatchObject({ status: 409, code: "LAST_OWNER" });
    expect(() =>
      service.requireRole({ ...owner, role: "viewer" }, ["owner", "member"]),
    ).toThrowError(
      new AuthError(403, "FORBIDDEN", "You do not have permission to do that."),
    );
  });
});
