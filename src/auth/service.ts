import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { AuthRepository, Membership, Principal, Role, SessionRecord } from "./types.js";

const GENERIC_SIGN_IN_ERROR = "The email or password is incorrect.";
const DUMMY_HASH = bcrypt.hashSync("northstar-dummy-password", 12);

export class AuthError extends Error {
  constructor(
    public readonly code: "invalid_credentials" | "unauthenticated" | "forbidden" | "conflict" | "validation",
    message: string,
  ) {
    super(message);
  }
}

export interface AuthServiceOptions {
  now?: () => Date;
  sessionTtlMs?: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) {
    throw new AuthError("validation", "Password must be between 12 and 256 characters.");
  }
  return bcrypt.hash(password, 12);
}

export class AuthService {
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;

  constructor(private readonly repository: AuthRepository, options: AuthServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  }

  async signIn(email: string, password: string, requestedOrganizationId?: string): Promise<{ token: string; principal: Principal }> {
    const user = await this.repository.findUserByNormalizedEmail(normalizeEmail(email));
    const passwordHash = user?.passwordHash ?? DUMMY_HASH;
    const validPassword = await bcrypt.compare(password, passwordHash);
    if (!user || user.disabledAt || !validPassword) {
      throw new AuthError("invalid_credentials", GENERIC_SIGN_IN_ERROR);
    }

    const memberships = await this.repository.findActiveMemberships(user.id);
    const membership = requestedOrganizationId
      ? memberships.find((candidate) => constantTimeEqual(candidate.organizationId, requestedOrganizationId))
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) {
      throw new AuthError("invalid_credentials", GENERIC_SIGN_IN_ERROR);
    }

    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const session: SessionRecord = {
      id: randomUUID(),
      tokenHash: hashToken(token),
      userId: user.id,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString(),
      revokedAt: null,
    };
    await this.repository.insertSession(session);
    return { token, principal: this.toPrincipal(session, membership) };
  }

  async authenticate(token: string | undefined): Promise<Principal> {
    if (!token) throw new AuthError("unauthenticated", "Sign in to continue.");
    const session = await this.repository.findSessionByTokenHash(hashToken(token));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= this.now().getTime()) {
      throw new AuthError("unauthenticated", "Your session has expired. Sign in again.");
    }
    const membership = await this.repository.findMembership(session.membershipId);
    if (!membership || membership.revokedAt || membership.userId !== session.userId || membership.organizationId !== session.organizationId) {
      throw new AuthError("unauthenticated", "Your access has changed. Sign in again.");
    }
    return this.toPrincipal(session, membership);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const session = await this.repository.findSessionByTokenHash(hashToken(token));
    if (session && !session.revokedAt) await this.repository.revokeSession(session.id, this.now().toISOString());
  }

  requireMutation(principal: Principal): void {
    if (principal.role === "viewer") throw new AuthError("forbidden", "You do not have permission to make changes.");
  }

  requireOwner(principal: Principal): void {
    if (principal.role !== "owner") throw new AuthError("forbidden", "Only organization owners can manage members.");
  }

  assertOrganization(principal: Principal, organizationId: string): void {
    if (!constantTimeEqual(principal.organizationId, organizationId)) {
      throw new AuthError("unauthenticated", "The requested record was not found.");
    }
  }

  async addMembership(principal: Principal, userId: string, role: Role): Promise<Membership> {
    this.requireOwner(principal);
    const membership: Membership = {
      id: randomUUID(), organizationId: principal.organizationId, userId, role, revokedAt: null,
    };
    await this.repository.insertMembership(membership);
    return membership;
  }

  async changeRole(principal: Principal, membershipId: string, role: Role): Promise<void> {
    this.requireOwner(principal);
    const target = await this.scopedMembership(principal, membershipId);
    if (target.role === "owner" && role !== "owner" && await this.repository.countActiveOwners(principal.organizationId) <= 1) {
      throw new AuthError("conflict", "The organization must retain at least one owner.");
    }
    await this.repository.updateMembershipRole(target.id, role);
    await this.repository.revokeSessionsForMembership(target.id, this.now().toISOString());
  }

  async revokeMembership(principal: Principal, membershipId: string): Promise<void> {
    this.requireOwner(principal);
    const target = await this.scopedMembership(principal, membershipId);
    if (target.role === "owner" && await this.repository.countActiveOwners(principal.organizationId) <= 1) {
      throw new AuthError("conflict", "The organization must retain at least one owner.");
    }
    const now = this.now().toISOString();
    await this.repository.revokeMembership(target.id, now);
    await this.repository.revokeSessionsForMembership(target.id, now);
  }

  private async scopedMembership(principal: Principal, membershipId: string): Promise<Membership> {
    const target = await this.repository.findMembership(membershipId);
    if (!target || target.revokedAt || target.organizationId !== principal.organizationId) {
      throw new AuthError("unauthenticated", "The requested member was not found.");
    }
    return target;
  }

  private toPrincipal(session: SessionRecord, membership: Membership): Principal {
    return {
      sessionId: session.id, userId: session.userId, organizationId: session.organizationId,
      membershipId: session.membershipId, role: membership.role, expiresAt: session.expiresAt,
    };
  }
}
