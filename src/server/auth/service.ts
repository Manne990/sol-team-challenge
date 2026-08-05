import { randomUUID } from "node:crypto";
import type { AuthenticatedUser, Role } from "../../shared/auth.js";
import { verifyPassword } from "./password.js";
import { createSessionSecret, hashSessionSecret, SESSION_TTL_MS } from "./session.js";
import type { AuthStore } from "./types.js";

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403 | 409, public readonly code: string, message: string) {
    super(message);
  }
}

export class AuthService {
  constructor(private readonly store: AuthStore, private readonly now = () => new Date()) {}

  async signIn(email: string, password: string): Promise<{ secret: string; user: AuthenticatedUser; expiresAt: Date }> {
    const normalizedEmail = email.trim().toLowerCase();
    const login = normalizedEmail ? await this.store.findLogin(normalizedEmail) : undefined;
    const valid = await verifyPassword(login?.passwordHash, password);
    if (!login || !valid) throw new AuthError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

    const secret = createSessionSecret();
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    await this.store.createSession({
      id: randomUUID(), tokenHash: hashSessionSecret(secret), userId: login.userId,
      organizationId: login.organizationId, expiresAt: expiresAt.toISOString(),
    });
    return {
      secret, expiresAt,
      user: {
        id: login.userId, membershipId: login.membershipId, email: login.email, name: login.name, role: login.role,
        organization: { id: login.organizationId, name: login.organizationName },
        sessionExpiresAt: expiresAt.toISOString(),
      },
    };
  }

  authenticate(secret: string | undefined): Promise<AuthenticatedUser | undefined> {
    return secret ? this.store.findSession(hashSessionSecret(secret), this.now().toISOString()) : Promise.resolve(undefined);
  }

  async signOut(secret: string | undefined): Promise<void> {
    if (secret) await this.store.revokeSession(hashSessionSecret(secret), this.now().toISOString());
  }

  requireRole(user: AuthenticatedUser | undefined, allowed: Role[]): AuthenticatedUser {
    if (!user) throw new AuthError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    if (!allowed.includes(user.role)) throw new AuthError(403, "FORBIDDEN", "You do not have permission to do that.");
    return user;
  }

  async changeRole(actor: AuthenticatedUser, memberId: string, role: Role): Promise<void> {
    this.requireRole(actor, ["owner"]);
    const result = await this.store.changeMemberRole({ organizationId: actor.organization.id, memberId, role, actorId: actor.id });
    if (result === "not_found") throw new AuthError(403, "FORBIDDEN", "You do not have permission to do that.");
    if (result === "last_owner") throw new AuthError(409, "LAST_OWNER", "Assign another owner before changing this role.");
  }

  async revokeMember(actor: AuthenticatedUser, memberId: string): Promise<void> {
    this.requireRole(actor, ["owner"]);
    const result = await this.store.revokeMember({ organizationId: actor.organization.id, memberId, actorId: actor.id });
    if (result === "not_found") throw new AuthError(403, "FORBIDDEN", "You do not have permission to do that.");
    if (result === "last_owner") throw new AuthError(409, "LAST_OWNER", "An organization must retain at least one owner.");
  }
}
