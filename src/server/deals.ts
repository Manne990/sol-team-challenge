import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AuthenticatedUser } from "../shared/auth.js";
import { AuthError, AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
type DealInput = {
  name: string;
  companyId: string;
  contactIds: string[];
  ownerMembershipId: string;
  stageId: string;
  amountMinor: number;
  currency: string;
  expectedCloseDate: string | null;
  probability: number;
};
const validation = (message: string) =>
  new AuthError(400, "VALIDATION_ERROR", message);
const requiredText = (value: unknown, maximum: number, label: string) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw validation(`Enter a valid ${label}.`);
  return value.trim();
};
const optionalDate = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  )
    throw validation("Enter an expected close date in YYYY-MM-DD format.");
  return value;
};
function dealInput(body: unknown): DealInput {
  const value = body && typeof body === "object" ? (body as Row) : {};
  const amountMinor = Number(value.amountMinor),
    probability = Number(value.probability);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw validation(
      "Amount must be a non-negative value in minor currency units.",
    );
  if (!Number.isInteger(probability) || probability < 0 || probability > 100)
    throw validation("Probability must be between 0 and 100.");
  const currency = requiredText(value.currency, 3, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency))
    throw validation("Currency must be a three-letter ISO code.");
  if (
    !Array.isArray(value.contactIds) ||
    value.contactIds.some((id) => typeof id !== "string")
  )
    throw validation("Contacts must be a list of record identifiers.");
  return {
    name: requiredText(value.name, 160, "deal name"),
    companyId: requiredText(value.companyId, 100, "company"),
    contactIds: [...new Set(value.contactIds)].slice(0, 50),
    ownerMembershipId: requiredText(value.ownerMembershipId, 100, "owner"),
    stageId: requiredText(value.stageId, 100, "stage"),
    amountMinor,
    currency,
    expectedCloseDate: optionalDate(value.expectedCloseDate),
    probability,
  };
}
const stageJson = (row: Row) => ({
  id: String(row.stage_id ?? row.id),
  name: String(row.stage_name ?? row.name),
  position: Number(row.stage_position ?? row.position),
  color: String(row.stage_color ?? row.color),
  isWon: Boolean(row.stage_is_won ?? row.is_won),
  isLost: Boolean(row.stage_is_lost ?? row.is_lost),
  active: Boolean(row.stage_active ?? row.active),
  version: Number(row.stage_version ?? row.version),
});
const dealJson = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  company: { id: String(row.company_id), name: String(row.company_name) },
  owner: { id: String(row.owner_membership_id), name: String(row.owner_name) },
  stage: stageJson(row),
  amountMinor: Number(row.amount_minor),
  currency: String(row.currency),
  expectedCloseDate: row.expected_close_date,
  probability: Number(row.probability),
  status: String(row.status),
  lossReason: row.loss_reason,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  archivedAt: row.archived_at,
  version: Number(row.deal_version ?? row.version),
});
const selectDeal = `SELECT d.*,d.version deal_version,co.name company_name,trim(u.first_name||' '||u.last_name) owner_name,
  s.name stage_name,s.position stage_position,s.color stage_color,s.is_won stage_is_won,s.is_lost stage_is_lost,s.active stage_active,s.version stage_version
  FROM deals d JOIN companies co ON co.id=d.company_id AND co.organization_id=d.organization_id
  JOIN memberships m ON m.id=d.owner_membership_id AND m.organization_id=d.organization_id JOIN users u ON u.id=m.user_id
  JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id`;

export class DealStore {
  constructor(private db: SqliteDatabase) {}
  stages(org: string, includeInactive = false) {
    return (
      this.db
        .prepare(
          `SELECT * FROM pipeline_stages WHERE organization_id=?${includeInactive ? "" : " AND active=1"} ORDER BY position,id`,
        )
        .all(org) as Row[]
    ).map(stageJson);
  }
  list(org: string, query: Row) {
    const clauses = ["d.organization_id=?"],
      args: unknown[] = [org];
    if (query.includeArchived !== "true") clauses.push("d.archived_at IS NULL");
    for (const [key, column] of [
      ["stageId", "d.stage_id"],
      ["status", "d.status"],
      ["ownerId", "d.owner_membership_id"],
      ["companyId", "d.company_id"],
    ] as const)
      if (typeof query[key] === "string" && query[key]) {
        clauses.push(`${column}=?`);
        args.push(query[key]);
      }
    if (typeof query.q === "string" && query.q.trim()) {
      clauses.push("(d.name LIKE ? OR co.name LIKE ?)");
      const q = `%${query.q.trim()}%`;
      args.push(q, q);
    }
    const where = clauses.join(" AND "),
      page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const countArgs = [...args];
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT count(*) count FROM deals d JOIN companies co ON co.id=d.company_id AND co.organization_id=d.organization_id WHERE ${where}`,
          )
          .get(...countArgs) as Row
      ).count,
    );
    const sort: Record<string, string> = {
      name: "d.name",
      amount: "d.amount_minor",
      closeDate: "d.expected_close_date",
      probability: "d.probability",
      updatedAt: "d.updated_at",
      stage: "s.position",
    };
    const order = query.direction === "desc" ? "DESC" : "ASC";
    const items = (
      this.db
        .prepare(
          `${selectDeal} WHERE ${where} ORDER BY ${sort[String(query.sort)] ?? "s.position"} ${order},d.id ${order} LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, (page - 1) * pageSize) as Row[]
    ).map(dealJson);
    const totals = this.db
      .prepare(
        `SELECT d.currency,count(*) count,sum(d.amount_minor) amountMinor FROM deals d JOIN companies co ON co.id=d.company_id AND co.organization_id=d.organization_id WHERE ${where} GROUP BY d.currency ORDER BY d.currency`,
      )
      .all(...countArgs) as Row[];
    return {
      deals: items,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
      totals: totals.map((x) => ({
        currency: String(x.currency),
        count: Number(x.count),
        amountMinor: Number(x.amountMinor),
      })),
    };
  }
  detail(org: string, id: string) {
    const row = this.db
      .prepare(`${selectDeal} WHERE d.organization_id=? AND d.id=?`)
      .get(org, id) as Row | undefined;
    if (!row) return undefined;
    const contacts = this.db
      .prepare(
        "SELECT c.id,c.first_name,c.last_name,c.email FROM deal_contacts dc JOIN contacts c ON c.id=dc.contact_id AND c.organization_id=dc.organization_id WHERE dc.organization_id=? AND dc.deal_id=? ORDER BY c.last_name,c.first_name,c.id",
      )
      .all(org, id) as Row[];
    const history = this.db
      .prepare(
        "SELECT h.id,h.moved_at,h.actor_membership_id,fs.name from_name,ts.name to_name FROM deal_stage_history h LEFT JOIN pipeline_stages fs ON fs.id=h.from_stage_id AND fs.organization_id=h.organization_id JOIN pipeline_stages ts ON ts.id=h.to_stage_id AND ts.organization_id=h.organization_id WHERE h.organization_id=? AND h.deal_id=? ORDER BY h.moved_at DESC,h.id DESC",
      )
      .all(org, id) as Row[];
    return {
      ...dealJson(row),
      contacts: contacts.map((x) => ({
        id: String(x.id),
        name: `${x.first_name} ${x.last_name}`,
        email: x.email,
      })),
      history: history.map((x) => ({
        id: String(x.id),
        fromStage: x.from_name,
        toStage: String(x.to_name),
        actorMembershipId: String(x.actor_membership_id),
        movedAt: String(x.moved_at),
      })),
    };
  }
  private relation(org: string, table: string, id: string, extra = "") {
    return this.db
      .prepare(
        `SELECT 1 FROM ${table} WHERE id=? AND organization_id=? ${extra}`,
      )
      .get(id, org);
  }
  private verify(actor: AuthenticatedUser, input: DealInput) {
    const org = actor.organization.id;
    if (
      !this.relation(
        org,
        "companies",
        input.companyId,
        "AND archived_at IS NULL",
      )
    )
      throw new AuthError(
        403,
        "FORBIDDEN",
        "The related company is unavailable.",
      );
    if (
      !this.relation(
        org,
        "memberships",
        input.ownerMembershipId,
        "AND status='active'",
      )
    )
      throw validation("Choose an active owner in this organization.");
    const stage = this.db
      .prepare(
        "SELECT * FROM pipeline_stages WHERE id=? AND organization_id=? AND active=1",
      )
      .get(input.stageId, org) as Row | undefined;
    if (!stage) throw validation("Choose an active pipeline stage.");
    for (const id of input.contactIds) {
      const c = this.db
        .prepare(
          "SELECT company_id FROM contacts WHERE id=? AND organization_id=? AND archived_at IS NULL",
        )
        .get(id, org) as Row | undefined;
      if (!c || c.company_id !== input.companyId)
        throw new AuthError(
          403,
          "FORBIDDEN",
          "A selected contact is unavailable for this company.",
        );
    }
    return stage;
  }
  write(
    actor: AuthenticatedUser,
    id: string | undefined,
    input: DealInput,
    expected?: number,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const stage = this.verify(actor, input),
        org = actor.organization.id,
        dealId = id ?? randomUUID(),
        now = new Date().toISOString(),
        currency = input.currency.toUpperCase();
      const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
      if (status === "lost")
        throw validation(
          "Move a deal to Lost separately and provide a loss reason.",
        );
      if (id) {
        const before = this.detail(org, id);
        if (!before) throw new AuthError(404, "NOT_FOUND", "Deal not found.");
        if (before.stage.id !== input.stageId)
          throw validation(
            "Use the stage transition action to preserve pipeline history.",
          );
        const result = this.db
          .prepare(
            "UPDATE deals SET company_id=?,owner_membership_id=?,name=?,amount_minor=?,currency=?,expected_close_date=?,probability=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(
            input.companyId,
            input.ownerMembershipId,
            input.name,
            input.amountMinor,
            currency,
            input.expectedCloseDate,
            input.probability,
            now,
            id,
            org,
            expected,
          );
        if (Number((result as Row).changes) === 0)
          throw new AuthError(
            409,
            "EDIT_CONFLICT",
            "This deal changed. Refresh and review the latest version.",
          );
      } else {
        this.db
          .prepare(
            "INSERT INTO deals(id,organization_id,company_id,owner_membership_id,stage_id,name,amount_minor,currency,expected_close_date,probability,status,loss_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            dealId,
            org,
            input.companyId,
            input.ownerMembershipId,
            input.stageId,
            input.name,
            input.amountMinor,
            currency,
            input.expectedCloseDate,
            input.probability,
            status,
            null,
            now,
            now,
          );
        this.db
          .prepare(
            "INSERT INTO deal_stage_history(id,organization_id,deal_id,from_stage_id,to_stage_id,actor_membership_id,moved_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            org,
            dealId,
            null,
            input.stageId,
            actor.membershipId,
            now,
          );
      }
      this.db
        .prepare(
          "DELETE FROM deal_contacts WHERE deal_id=? AND organization_id=?",
        )
        .run(dealId, org);
      const link = this.db.prepare(
        "INSERT INTO deal_contacts(organization_id,deal_id,contact_id,created_at) VALUES(?,?,?,?)",
      );
      for (const contactId of input.contactIds)
        link.run(org, dealId, contactId, now);
      this.audit(actor, id ? "deal.updated" : "deal.created", dealId, {
        name: input.name,
      });
      this.db.exec("COMMIT");
      return this.detail(org, dealId)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  transition(
    actor: AuthenticatedUser,
    id: string,
    stageId: string,
    version: number,
    lossReason: unknown,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const org = actor.organization.id,
        before = this.detail(org, id);
      if (!before) throw new AuthError(404, "NOT_FOUND", "Deal not found.");
      const stage = this.db
        .prepare(
          "SELECT * FROM pipeline_stages WHERE id=? AND organization_id=? AND active=1",
        )
        .get(stageId, org) as Row | undefined;
      if (!stage) throw validation("Choose an active pipeline stage.");
      const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
      let reason: null | string = null;
      if (status === "lost")
        reason = requiredText(lossReason, 500, "loss reason");
      else if (lossReason)
        throw validation("A loss reason is only valid for a lost deal.");
      const now = new Date().toISOString(),
        result = this.db
          .prepare(
            "UPDATE deals SET stage_id=?,status=?,loss_reason=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=? AND archived_at IS NULL",
          )
          .run(stageId, status, reason, now, id, org, version);
      if (Number((result as Row).changes) === 0)
        throw new AuthError(
          409,
          "EDIT_CONFLICT",
          "This deal changed. Refresh and review the latest version.",
        );
      this.db
        .prepare(
          "INSERT INTO deal_stage_history(id,organization_id,deal_id,from_stage_id,to_stage_id,actor_membership_id,moved_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          org,
          id,
          before.stage.id,
          stageId,
          actor.membershipId,
          now,
        );
      this.audit(actor, "deal.stage_changed", id, {
        from: before.stage.name,
        to: String(stage.name),
        status,
      });
      this.db.exec("COMMIT");
      return this.detail(org, id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  archive(actor: AuthenticatedUser, id: string, restore = false) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE deals SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND archived_at IS ${restore ? "NOT " : ""}NULL`,
      )
      .run(restore ? null : now, now, id, actor.organization.id);
    if (Number((result as Row).changes) === 0)
      throw new AuthError(404, "NOT_FOUND", "Deal not found.");
    this.audit(actor, restore ? "deal.restored" : "deal.archived", id, {});
    return this.detail(actor.organization.id, id)!;
  }
  createStage(actor: AuthenticatedUser, body: unknown) {
    const x = body && typeof body === "object" ? (body as Row) : {};
    const name = requiredText(x.name, 80, "stage name"),
      color = requiredText(x.color, 20, "stage color");
    if (!/^#[0-9a-f]{6}$/iu.test(color))
      throw validation("Choose a six-digit hexadecimal stage color.");
    const outcome = x.outcome ?? "open";
    if (!["open", "won", "lost"].includes(String(outcome)))
      throw validation("Choose an open, won, or lost outcome.");
    const pos = Number(
        (
          this.db
            .prepare(
              "SELECT coalesce(max(position),-1)+1 position FROM pipeline_stages WHERE organization_id=?",
            )
            .get(actor.organization.id) as Row
        ).position,
      ),
      now = new Date().toISOString(),
      id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO pipeline_stages(id,organization_id,name,position,color,is_won,is_lost,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        actor.organization.id,
        name,
        pos,
        color,
        outcome === "won" ? 1 : 0,
        outcome === "lost" ? 1 : 0,
        now,
        now,
      );
    this.audit(actor, "pipeline_stage.created", id, { name });
    return this.stages(actor.organization.id, true).find((s) => s.id === id)!;
  }
  updateStage(actor: AuthenticatedUser, id: string, body: unknown) {
    const x = body && typeof body === "object" ? (body as Row) : {};
    const current = this.db
      .prepare("SELECT * FROM pipeline_stages WHERE id=? AND organization_id=?")
      .get(id, actor.organization.id) as Row | undefined;
    if (!current)
      throw new AuthError(404, "NOT_FOUND", "Pipeline stage not found.");
    const version = Number(x.version);
    if (!Number.isInteger(version))
      throw validation("Refresh the stage before saving.");
    const name = requiredText(x.name ?? current.name, 80, "stage name"),
      color = requiredText(x.color ?? current.color, 20, "stage color"),
      active =
        x.active === undefined ? Number(current.active) : x.active ? 1 : 0,
      position =
        x.position === undefined
          ? Number(current.position)
          : Number(x.position),
      maximum = Number(
        (
          this.db
            .prepare(
              "SELECT max(position) position FROM pipeline_stages WHERE organization_id=?",
            )
            .get(actor.organization.id) as Row
        ).position,
      );
    if (!Number.isInteger(position) || position < 0 || position > maximum)
      throw validation("Choose a valid pipeline position.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (position !== Number(current.position)) {
        this.db
          .prepare(
            "UPDATE pipeline_stages SET position=? WHERE id=? AND organization_id=?",
          )
          .run(maximum + 1, id, actor.organization.id);
        this.db
          .prepare(
            "UPDATE pipeline_stages SET position=? WHERE organization_id=? AND position=?",
          )
          .run(Number(current.position), actor.organization.id, position);
      }
      const result = this.db
        .prepare(
          "UPDATE pipeline_stages SET name=?,color=?,active=?,position=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
        )
        .run(
          name,
          color,
          active,
          position,
          new Date().toISOString(),
          id,
          actor.organization.id,
          version,
        );
      if (Number((result as Row).changes) === 0)
        throw new AuthError(
          409,
          "EDIT_CONFLICT",
          "This pipeline stage changed. Refresh and try again.",
        );
      this.audit(actor, "pipeline_stage.updated", id, {
        name,
        active: Boolean(active),
        position,
      });
      this.db.exec("COMMIT");
      return this.stages(actor.organization.id, true).find((s) => s.id === id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private audit(
    actor: AuthenticatedUser,
    action: string,
    id: string,
    summary: object,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type,entity_id,correlation_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        actor.organization.id,
        actor.membershipId,
        action,
        action.startsWith("pipeline_stage") ? "pipeline_stage" : "deal",
        id,
        randomUUID(),
        JSON.stringify(summary),
        new Date().toISOString(),
      );
  }
}

export function dealsRouter(db: SqliteDatabase, auth: AuthService) {
  const router = Router(),
    store = new DealStore(db);
  const actor = async (
    req: Request,
    roles: ("owner" | "member" | "viewer")[] = ["owner", "member", "viewer"],
  ) =>
    auth.requireRole(
      await auth.authenticate(readCookie(req.headers.cookie, SESSION_COOKIE)),
      roles,
    );
  router.get("/stages", async (req, res, next) => {
    try {
      const u = await actor(req);
      res.json({
        stages: store.stages(
          u.organization.id,
          req.query.includeInactive === "true",
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post("/stages", async (req, res, next) => {
    try {
      res.status(201).json({
        stage: store.createStage(await actor(req, ["owner"]), req.body),
      });
    } catch (e) {
      next(e);
    }
  });
  router.patch("/stages/:id", async (req, res, next) => {
    try {
      res.json({
        stage: store.updateStage(
          await actor(req, ["owner"]),
          String(req.params.id),
          req.body,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get("/", async (req, res, next) => {
    try {
      const u = await actor(req);
      res.json(store.list(u.organization.id, req.query as Row));
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      const u = await actor(req),
        deal = store.detail(u.organization.id, String(req.params.id));
      if (!deal) throw new AuthError(404, "NOT_FOUND", "Deal not found.");
      res.json({ deal });
    } catch (e) {
      next(e);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      res.status(201).json({
        deal: store.write(
          await actor(req, ["owner", "member"]),
          undefined,
          dealInput(req.body),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.patch("/:id", async (req, res, next) => {
    try {
      const version = Number((req.body as Row)?.version);
      if (!Number.isInteger(version))
        throw validation("Refresh the deal before saving.");
      res.json({
        deal: store.write(
          await actor(req, ["owner", "member"]),
          String(req.params.id),
          dealInput(req.body),
          version,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post("/:id/transition", async (req, res, next) => {
    try {
      const body = req.body as Row;
      res.json({
        deal: store.transition(
          await actor(req, ["owner", "member"]),
          String(req.params.id),
          requiredText(body?.stageId, 100, "stage"),
          Number(body?.version),
          body?.lossReason,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  for (const [route, restore] of [
    ["archive", false],
    ["restore", true],
  ] as const)
    router.post(`/:id/${route}`, async (req, res, next) => {
      try {
        res.json({
          deal: store.archive(
            await actor(req, ["owner", "member"]),
            String(req.params.id),
            restore,
          ),
        });
      } catch (e) {
        next(e);
      }
    });
  return router;
}
