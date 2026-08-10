export const roles = ["owner", "member", "viewer"] as const;
export type Role = (typeof roles)[number];

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  disabledAt: string | null;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  revokedAt: string | null;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  organizationId: string;
  membershipId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface Principal {
  sessionId: string;
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  expiresAt: string;
}

export interface AuthRepository {
  findUserByNormalizedEmail(email: string): Promise<UserAccount | null>;
  findActiveMemberships(userId: string): Promise<Membership[]>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findMembership(id: string): Promise<Membership | null>;
  insertSession(session: SessionRecord): Promise<void>;
  revokeSession(id: string, revokedAt: string): Promise<void>;
  revokeSessionsForMembership(
    membershipId: string,
    revokedAt: string,
  ): Promise<void>;
  countActiveOwners(organizationId: string): Promise<number>;
  insertMembership(membership: Membership): Promise<void>;
  updateMembershipRole(id: string, role: Role): Promise<void>;
  revokeMembership(id: string, revokedAt: string): Promise<void>;
}
