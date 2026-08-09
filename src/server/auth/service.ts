import { randomUUID } from "node:crypto";
import type { AuthenticatedUser, Role } from "../../shared/auth.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  createSessionSecret,
  hashSessionSecret,
  SESSION_TTL_MS,
} from "./session.js";
import type { AuthStore } from "./types.js";

export class AuthError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly now = () => new Date(),
  ) {}

  async signIn(
    email: string,
    password: string,
  ): Promise<{ secret: string; user: AuthenticatedUser; expiresAt: Date }> {
    const normalizedEmail = email.trim().toLowerCase();
    const login = normalizedEmail
      ? await this.store.findLogin(normalizedEmail)
      : undefined;
    const valid = await verifyPassword(login?.passwordHash, password);
    if (!login || !valid)
      throw new AuthError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );

    const secret = createSessionSecret();
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    await this.store.createSession({
      id: randomUUID(),
      tokenHash: hashSessionSecret(secret),
      userId: login.userId,
      organizationId: login.organizationId,
      expiresAt: expiresAt.toISOString(),
    });
    return {
      secret,
      expiresAt,
      user: {
        id: login.userId,
        membershipId: login.membershipId,
        email: login.email,
        name: login.name,
        role: login.role,
        organization: {
          id: login.organizationId,
          name: login.organizationName,
        },
        sessionExpiresAt: expiresAt.toISOString(),
      },
    };
  }

  authenticate(
    secret: string | undefined,
  ): Promise<AuthenticatedUser | undefined> {
    return secret
      ? this.store.findSession(
          hashSessionSecret(secret),
          this.now().toISOString(),
        )
      : Promise.resolve(undefined);
  }

  async signOut(secret: string | undefined): Promise<void> {
    if (secret)
      await this.store.revokeSession(
        hashSessionSecret(secret),
        this.now().toISOString(),
      );
  }

  async members(actor: AuthenticatedUser) {
    this.requireRole(actor, ["owner"]);
    return this.store.listMembers(actor.organization.id);
  }

  async createMember(
    actor: AuthenticatedUser,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      role: Role;
    },
  ) {
    this.requireRole(actor, ["owner"]);
    const email = input.email.trim().toLowerCase();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!/^\S+@\S+\.\S+$/u.test(email) || email.length > 254)
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Enter a valid email address.",
      );
    if (
      !firstName ||
      !lastName ||
      firstName.length > 80 ||
      lastName.length > 80
    )
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Enter the member's first and last name.",
      );
    if (input.password.length < 12 || input.password.length > 1024)
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Use a password with at least 12 characters.",
      );
    const result = await this.store.createMember({
      organizationId: actor.organization.id,
      email,
      firstName,
      lastName,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      actorId: actor.id,
    });
    if (result === "conflict")
      throw new AuthError(
        409,
        "MEMBER_CONFLICT",
        "A member with that email already exists.",
      );
    return result;
  }

  requireRole(
    user: AuthenticatedUser | undefined,
    allowed: Role[],
  ): AuthenticatedUser {
    if (!user)
      throw new AuthError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
      );
    if (!allowed.includes(user.role))
      throw new AuthError(
        403,
        "FORBIDDEN",
        "You do not have permission to do that.",
      );
    return user;
  }

  async changeRole(
    actor: AuthenticatedUser,
    memberId: string,
    role: Role,
  ): Promise<void> {
    this.requireRole(actor, ["owner"]);
    const result = await this.store.changeMemberRole({
      organizationId: actor.organization.id,
      memberId,
      role,
      actorId: actor.id,
    });
    if (result === "not_found")
      throw new AuthError(
        403,
        "FORBIDDEN",
        "You do not have permission to do that.",
      );
    if (result === "last_owner")
      throw new AuthError(
        409,
        "LAST_OWNER",
        "Assign another owner before changing this role.",
      );
  }

  async revokeMember(
    actor: AuthenticatedUser,
    memberId: string,
  ): Promise<void> {
    this.requireRole(actor, ["owner"]);
    const result = await this.store.revokeMember({
      organizationId: actor.organization.id,
      memberId,
      actorId: actor.id,
    });
    if (result === "not_found")
      throw new AuthError(
        403,
        "FORBIDDEN",
        "You do not have permission to do that.",
      );
    if (result === "last_owner")
      throw new AuthError(
        409,
        "LAST_OWNER",
        "An organization must retain at least one owner.",
      );
  }
}
