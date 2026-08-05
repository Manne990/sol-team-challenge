import { randomUUID } from "node:crypto";
import type { AuthenticatedUser, Role } from "../../shared/auth.js";
import type { AuthStore } from "./types.js";

type Row = Record<string, unknown>;
type Statement = {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): unknown;
};
export type SqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
};

export class SqliteAuthStore implements AuthStore {
  constructor(private readonly db: SqliteDatabase) {}

  async findLogin(email: string) {
    const row = this.db
      .prepare(
        `SELECT u.id user_id,u.email,u.first_name,u.last_name,u.password_hash,
      m.id membership_id,m.role,o.id organization_id,o.name organization_name
      FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id
      WHERE u.email=? COLLATE NOCASE AND u.disabled_at IS NULL AND m.status='active'
      ORDER BY m.created_at,m.id LIMIT 1`,
      )
      .get(email) as Row | undefined;
    if (!row) return undefined;
    return {
      userId: String(row.user_id),
      membershipId: String(row.membership_id),
      email: String(row.email),
      name: `${String(row.first_name)} ${String(row.last_name)}`.trim(),
      passwordHash: String(row.password_hash),
      organizationId: String(row.organization_id),
      organizationName: String(row.organization_name),
      role: row.role as Role,
    };
  }

  async createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: string;
  }) {
    const membership = this.db
      .prepare(
        "SELECT id FROM memberships WHERE user_id=? AND organization_id=? AND status='active'",
      )
      .get(input.userId, input.organizationId) as Row | undefined;
    if (!membership)
      throw new Error("Active membership disappeared while creating a session");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id,token_hash,organization_id,membership_id,created_at,expires_at,revoked_at,last_seen_at)
      VALUES(?,?,?,?,?,?,NULL,?)`,
      )
      .run(
        input.id,
        input.tokenHash,
        input.organizationId,
        membership.id,
        now,
        input.expiresAt,
        now,
      );
    this.audit(
      input.organizationId,
      input.userId,
      "authentication.signed_in",
      String(membership.id),
      {},
      now,
      "authentication",
    );
  }

  async findSession(
    tokenHash: string,
    now: string,
  ): Promise<AuthenticatedUser | undefined> {
    const row = this.db
      .prepare(
        `SELECT u.id user_id,u.email,u.first_name,u.last_name,m.id membership_id,m.role,
      o.id organization_id,o.name organization_name,s.expires_at FROM sessions s
      JOIN memberships m ON m.id=s.membership_id AND m.organization_id=s.organization_id
      JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=s.organization_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND m.status='active' AND u.disabled_at IS NULL`,
      )
      .get(tokenHash, now) as Row | undefined;
    if (!row) return undefined;
    this.db
      .prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=?")
      .run(now, tokenHash);
    return {
      id: String(row.user_id),
      membershipId: String(row.membership_id),
      email: String(row.email),
      name: `${String(row.first_name)} ${String(row.last_name)}`.trim(),
      role: row.role as Role,
      organization: {
        id: String(row.organization_id),
        name: String(row.organization_name),
      },
      sessionExpiresAt: String(row.expires_at),
    };
  }

  async revokeSession(tokenHash: string, now: string) {
    const session = this.db
      .prepare(
        "SELECT s.organization_id,m.user_id,m.id membership_id FROM sessions s JOIN memberships m ON m.id=s.membership_id AND m.organization_id=s.organization_id WHERE s.token_hash=? AND s.revoked_at IS NULL",
      )
      .get(tokenHash) as Row | undefined;
    this.db
      .prepare(
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?",
      )
      .run(now, tokenHash);
    if (session)
      this.audit(
        String(session.organization_id),
        String(session.user_id),
        "authentication.signed_out",
        String(session.membership_id),
        {},
        now,
        "authentication",
      );
  }

  async listMembers(organizationId: string) {
    return (
      this.db
        .prepare(
          `SELECT m.id,u.email,u.first_name,u.last_name,m.role FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=? AND m.status='active' ORDER BY u.last_name,u.first_name,u.id`,
        )
        .all(organizationId) as Row[]
    ).map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: `${String(row.first_name)} ${String(row.last_name)}`.trim(),
      role: row.role as Role,
    }));
  }

  async createMember(input: {
    organizationId: string;
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
    role: Role;
    actorId: string;
  }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db
          .prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE")
          .get(input.email)
      ) {
        this.db.exec("ROLLBACK");
        return "conflict" as const;
      }
      const now = new Date().toISOString();
      const userId = randomUUID();
      const memberId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO users (id,email,password_hash,first_name,last_name,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          userId,
          input.email,
          input.passwordHash,
          input.firstName,
          input.lastName,
          now,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO memberships (id,organization_id,user_id,role,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          memberId,
          input.organizationId,
          userId,
          input.role,
          "active",
          now,
          now,
        );
      this.audit(
        input.organizationId,
        input.actorId,
        "membership.created",
        memberId,
        { role: input.role },
        now,
      );
      this.db.exec("COMMIT");
      return {
        id: memberId,
        email: input.email,
        name: `${input.firstName} ${input.lastName}`,
        role: input.role,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async changeMemberRole(input: {
    organizationId: string;
    memberId: string;
    role: Role;
    actorId: string;
  }) {
    return this.membershipTransaction(
      input.organizationId,
      input.memberId,
      (member, now) => {
        if (
          member.role === "owner" &&
          input.role !== "owner" &&
          this.ownerCount(input.organizationId) === 1
        )
          return "last_owner";
        this.db
          .prepare(
            "UPDATE memberships SET role=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
          )
          .run(input.role, now, input.memberId, input.organizationId);
        this.audit(
          input.organizationId,
          input.actorId,
          "membership.role_changed",
          input.memberId,
          { from: member.role, to: input.role },
          now,
        );
        return "ok";
      },
    );
  }

  async revokeMember(input: {
    organizationId: string;
    memberId: string;
    actorId: string;
  }) {
    return this.membershipTransaction(
      input.organizationId,
      input.memberId,
      (member, now) => {
        if (
          member.role === "owner" &&
          this.ownerCount(input.organizationId) === 1
        )
          return "last_owner";
        this.db
          .prepare(
            "UPDATE memberships SET status='revoked',updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
          )
          .run(now, input.memberId, input.organizationId);
        this.db
          .prepare(
            "UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE membership_id=? AND organization_id=?",
          )
          .run(now, input.memberId, input.organizationId);
        this.audit(
          input.organizationId,
          input.actorId,
          "membership.revoked",
          input.memberId,
          {},
          now,
        );
        return "ok";
      },
    );
  }

  private membershipTransaction(
    organizationId: string,
    memberId: string,
    operation: (member: { role: Role }, now: string) => "ok" | "last_owner",
  ): "ok" | "not_found" | "last_owner" {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const member = this.db
        .prepare(
          "SELECT role FROM memberships WHERE id=? AND organization_id=? AND status='active'",
        )
        .get(memberId, organizationId) as { role: Role } | undefined;
      if (!member) {
        this.db.exec("ROLLBACK");
        return "not_found";
      }
      const result = operation(member, new Date().toISOString());
      this.db.exec(result === "ok" ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private ownerCount(organizationId: string): number {
    const row = this.db
      .prepare(
        "SELECT count(*) count FROM memberships WHERE organization_id=? AND status='active' AND role='owner'",
      )
      .get(organizationId) as { count: number };
    return Number(row.count);
  }

  private audit(
    organizationId: string,
    actorUserId: string,
    action: string,
    entityId: string,
    summary: object,
    now: string,
    entityType = "membership",
  ) {
    const actor = this.db
      .prepare(
        "SELECT id FROM memberships WHERE organization_id=? AND user_id=? AND status='active'",
      )
      .get(organizationId, actorUserId) as Row | undefined;
    this.db
      .prepare(
        `INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        organizationId,
        actor?.id ?? null,
        action,
        entityType,
        entityId,
        randomUUID(),
        JSON.stringify(summary),
        now,
      );
  }
}
