import type { DatabaseSync } from "node:sqlite";
import type {
  AuthRepository,
  Membership,
  Role,
  SessionRecord,
  UserAccount,
} from "./types.js";

const membershipId = (organizationId: string, userId: string) =>
  `${organizationId}:${userId}`;
function splitMembershipId(id: string): [string, string] | null {
  const separator = id.indexOf(":");
  return separator < 1
    ? null
    : [id.slice(0, separator), id.slice(separator + 1)];
}

type Row = Record<string, unknown>;
function user(row: Row): UserAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    displayName: String(row.display_name),
    disabledAt: row.disabled_at ? String(row.disabled_at) : null,
  };
}
function membership(row: Row): Membership {
  const organizationId = String(row.organization_id);
  const userId = String(row.user_id);
  return {
    id: membershipId(organizationId, userId),
    organizationId,
    userId,
    role: String(row.role) as Role,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}
function session(row: Row): SessionRecord {
  const organizationId = String(row.organization_id);
  const userId = String(row.user_id);
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    userId,
    organizationId,
    membershipId: membershipId(organizationId, userId),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
  };
}

export class SqliteAuthRepository implements AuthRepository {
  constructor(private readonly db: DatabaseSync) {}
  async findUserByNormalizedEmail(email: string) {
    const row = this.db
      .prepare(
        "SELECT id,email,password_hash,display_name,disabled_at FROM users WHERE email=? COLLATE NOCASE",
      )
      .get(email) as Row | undefined;
    return row ? user(row) : null;
  }
  async findActiveMemberships(userId: string) {
    return (
      this.db
        .prepare(
          "SELECT organization_id,user_id,role,revoked_at FROM memberships WHERE user_id=? AND revoked_at IS NULL ORDER BY organization_id",
        )
        .all(userId) as Row[]
    ).map(membership);
  }
  async findSessionByTokenHash(hash: string) {
    const row = this.db
      .prepare(
        "SELECT id,token_hash,user_id,organization_id,expires_at,revoked_at,created_at FROM sessions WHERE token_hash=?",
      )
      .get(hash) as Row | undefined;
    return row ? session(row) : null;
  }
  async findMembership(id: string) {
    const key = splitMembershipId(id);
    if (!key) return null;
    const row = this.db
      .prepare(
        "SELECT organization_id,user_id,role,revoked_at FROM memberships WHERE organization_id=? AND user_id=?",
      )
      .get(...key) as Row | undefined;
    return row ? membership(row) : null;
  }
  async insertSession(value: SessionRecord) {
    this.db
      .prepare(
        "INSERT INTO sessions(id,user_id,organization_id,token_hash,expires_at,created_at,revoked_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        value.id,
        value.userId,
        value.organizationId,
        value.tokenHash,
        value.expiresAt,
        value.createdAt,
        value.revokedAt,
      );
  }
  async revokeSession(id: string, at: string) {
    this.db
      .prepare(
        "UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
      )
      .run(at, id);
  }
  async revokeSessionsForMembership(id: string, at: string) {
    const key = splitMembershipId(id);
    if (key)
      this.db
        .prepare(
          "UPDATE sessions SET revoked_at=? WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
        )
        .run(at, ...key);
  }
  async countActiveOwners(org: string) {
    const row = this.db
      .prepare(
        "SELECT count(*) AS count FROM memberships WHERE organization_id=? AND role='owner' AND revoked_at IS NULL",
      )
      .get(org) as { count: number };
    return Number(row.count);
  }
  async insertMembership(value: Membership) {
    this.db
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role,created_at) VALUES (?,?,?,?)",
      )
      .run(
        value.organizationId,
        value.userId,
        value.role,
        new Date().toISOString(),
      );
  }
  async updateMembershipRole(id: string, role: Role) {
    const key = splitMembershipId(id);
    if (!key) return;
    this.db
      .prepare(
        "UPDATE memberships SET role=? WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
      )
      .run(role, ...key);
  }
  async revokeMembership(id: string, at: string) {
    const key = splitMembershipId(id);
    if (!key) return;
    this.db
      .prepare(
        "UPDATE memberships SET revoked_at=? WHERE organization_id=? AND user_id=? AND revoked_at IS NULL",
      )
      .run(at, ...key);
  }
}
