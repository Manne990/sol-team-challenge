import type { AuthenticatedUser, Role } from "../../shared/auth.js";

export interface AuthRequest {
  headers: { cookie?: string };
  protocol?: string;
  auth?: AuthenticatedUser;
}

export interface AuthStore {
  findLogin(email: string): Promise<
    | {
        userId: string;
        membershipId: string;
        email: string;
        name: string;
        passwordHash: string;
        organizationId: string;
        organizationName: string;
        role: Role;
      }
    | undefined
  >;
  createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: string;
  }): Promise<void>;
  findSession(
    tokenHash: string,
    now: string,
  ): Promise<AuthenticatedUser | undefined>;
  revokeSession(tokenHash: string, now: string): Promise<void>;
  listMembers(
    organizationId: string,
  ): Promise<Array<{ id: string; email: string; name: string; role: Role }>>;
  createMember(input: {
    organizationId: string;
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
    role: Role;
    actorId: string;
  }): Promise<
    { id: string; email: string; name: string; role: Role } | "conflict"
  >;
  changeMemberRole(input: {
    organizationId: string;
    memberId: string;
    role: Role;
    actorId: string;
  }): Promise<"ok" | "not_found" | "last_owner">;
  revokeMember(input: {
    organizationId: string;
    memberId: string;
    actorId: string;
  }): Promise<"ok" | "not_found" | "last_owner">;
}
