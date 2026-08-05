export const roles = ["owner", "member", "viewer"] as const;

export type Role = (typeof roles)[number];

export interface AuthenticatedUser {
  id: string;
  membershipId: string;
  email: string;
  name: string;
  organization: { id: string; name: string };
  role: Role;
  sessionExpiresAt: string;
}

export interface AuthResponse {
  user: AuthenticatedUser;
}

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && roles.includes(value as Role);
