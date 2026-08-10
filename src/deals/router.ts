import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Router, type Request, type Response } from "express";
import { readSessionCookie, requestHasTrustedOrigin } from "../auth/http.js";
import { AuthError, AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";
import type { Principal } from "../auth/types.js";

type Row = Record<string, unknown>;
class DealError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const clean = (value: unknown, maximum = 200) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";
const optional = (value: unknown, maximum = 200) =>
  clean(value, maximum) || null;
const sendError = (error: unknown, response: Response) => {
  if (error instanceof DealError)
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  else if (error instanceof AuthError)
    response
      .status(error.code === "forbidden" ? 403 : 401)
      .json({ error: { code: error.code, message: error.message } });
  else throw error;
};

function parseDeal(body: Record<string, unknown>) {
  const name = clean(body.name, 160);
  const companyId = clean(body.companyId, 100);
  const ownerId = clean(body.ownerId, 100);
  const stageId = clean(body.stageId, 100);
  const amountMinor = Number(body.amountMinor ?? 0);
  const probability = Number(body.probability ?? 0);
  const currency = clean(body.currency ?? "USD", 3).toUpperCase();
  const expectedCloseDate = optional(body.expectedCloseDate, 10);
  if (!name || !companyId || !ownerId || !stageId)
    throw new DealError(
      400,
      "VALIDATION",
      "Name, company, owner, and stage are required.",
    );
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new DealError(
      400,
      "VALIDATION",
      "Amount must be a non-negative minor-unit integer.",
    );
  if (!Number.isInteger(probability) || probability < 0 || probability > 100)
    throw new DealError(
      400,
      "VALIDATION",
      "Probability must be between 0 and 100.",
    );
  if (!/^[A-Z]{3}$/u.test(currency))
    throw new DealError(
      400,
      "VALIDATION",
      "Currency must be a three-letter ISO code.",
    );
  if (expectedCloseDate && !/^\d{4}-\d{2}-\d{2}$/u.test(expectedCloseDate))
    throw new DealError(
      400,
      "VALIDATION",
      "Expected close date must use YYYY-MM-DD.",
    );
  const contactIds = Array.isArray(body.contactIds)
    ? [...new Set(body.contactIds.map((id) => clean(id, 100)).filter(Boolean))]
    : [];
  return {
    name,
    companyId,
    ownerId,
    stageId,
    amountMinor,
    probability,
    currency,
    expectedCloseDate,
    contactIds,
  };
}

const dealJson = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  company: { id: String(row.company_id), name: String(row.company_name ?? "") },
  owner: { id: String(row.owner_id), name: String(row.owner_name ?? "") },
  amountMinor: Number(row.amount_minor),
  currency: String(row.currency),
  expectedCloseDate: row.expected_close_date
    ? String(row.expected_close_date)
    : null,
  probability: Number(row.probability),
  stage: {
    id: String(row.stage_id),
    name: String(row.stage_name ?? ""),
    position: Number(row.stage_position ?? 0),
  },
  status: String(row.status),
  lossReason: row.loss_reason ? String(row.loss_reason) : null,
  archivedAt: row.archived_at ? String(row.archived_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  version: Number(row.version),
});
const selectDeal = `SELECT d.*,c.name company_name,u.display_name owner_name,s.name stage_name,s.position stage_position
 FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id
 JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id
 JOIN users u ON u.id=d.owner_id`;

export function createDealsRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router();
  const auth = new AuthService(new SqliteAuthRepository(database));
  const principal = (request: Request) =>
    auth.authenticate(readSessionCookie(request.header("cookie")));
  const mutation = async (request: Request) => {
    const user = await principal(request);
    auth.requireMutation(user);
    if (
      !requestHasTrustedOrigin(
        request.header("origin"),
        request.header("host"),
        secureCookies,
      )
    )
      throw new AuthError("forbidden", "The request origin is not allowed.");
    return user;
  };
  const locate = (id: string, user: Principal) =>
    database
      .prepare(`${selectDeal} WHERE d.id=? AND d.organization_id=?`)
      .get(id, user.organizationId) as Row | undefined;
  const audit = (
    user: Principal,
    action: string,
    id: string,
    summary: object,
    requestId: string,
    now: string,
  ) =>
    database
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        user.organizationId,
        user.userId,
        action,
        "deal",
        id,
        requestId,
        JSON.stringify(summary),
        now,
      );
  const verify = (user: Principal, value: ReturnType<typeof parseDeal>) => {
    if (
      !database
        .prepare(
          "SELECT 1 FROM companies WHERE id=? AND organization_id=? AND archived_at IS NULL",
        )
        .get(value.companyId, user.organizationId)
    )
      throw new DealError(
        404,
        "NOT_FOUND",
        "The requested related record was not found.",
      );
    if (
      !database
        .prepare(
          "SELECT 1 FROM memberships WHERE user_id=? AND organization_id=? AND revoked_at IS NULL",
        )
        .get(value.ownerId, user.organizationId)
    )
      throw new DealError(
        400,
        "VALIDATION",
        "Choose an active owner in this organization.",
      );
    if (
      !database
        .prepare(
          "SELECT 1 FROM pipeline_stages WHERE id=? AND organization_id=? AND is_active=1",
        )
        .get(value.stageId, user.organizationId)
    )
      throw new DealError(
        400,
        "VALIDATION",
        "Choose an active pipeline stage.",
      );
    for (const contactId of value.contactIds)
      if (
        !database
          .prepare(
            "SELECT 1 FROM contacts WHERE id=? AND organization_id=? AND archived_at IS NULL",
          )
          .get(contactId, user.organizationId)
      )
        throw new DealError(
          404,
          "NOT_FOUND",
          "The requested related record was not found.",
        );
  };

  router.get("/stages", async (request, response) => {
    try {
      const user = await principal(request);
      const rows = database
        .prepare(
          "SELECT id,name,position,color,is_active,version FROM pipeline_stages WHERE organization_id=? ORDER BY position,id",
        )
        .all(user.organizationId) as Row[];
      response.json({
        items: rows.map((r) => ({
          id: String(r.id),
          name: String(r.name),
          position: Number(r.position),
          color: String(r.color),
          active: Boolean(r.is_active),
          version: Number(r.version),
        })),
      });
    } catch (error) {
      sendError(error, response);
    }
  });

  router.put("/stages", async (request, response) => {
    try {
      const user = await mutation(request);
      if (user.role !== "owner")
        throw new AuthError(
          "forbidden",
          "Only owners can configure pipeline stages.",
        );
      if (
        !Array.isArray(request.body?.stages) ||
        request.body.stages.length < 1
      )
        throw new DealError(
          400,
          "VALIDATION",
          "Provide at least one pipeline stage.",
        );
      const stages = request.body.stages.map(
        (stage: Record<string, unknown>, position: number) => ({
          id: optional(stage.id, 100),
          name: clean(stage.name, 80),
          color: clean(stage.color, 20) || "#64748b",
          active: stage.active !== false,
          position,
        }),
      );
      if (stages.some((stage: { name: string }) => !stage.name))
        throw new DealError(400, "VALIDATION", "Every stage needs a name.");
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "UPDATE pipeline_stages SET position=position+1000 WHERE organization_id=?",
          )
          .run(user.organizationId);
        for (const stage of stages) {
          if (stage.id) {
            const result = database
              .prepare(
                "UPDATE pipeline_stages SET name=?,position=?,color=?,is_active=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
              )
              .run(
                stage.name,
                stage.position,
                stage.color,
                stage.active ? 1 : 0,
                now,
                stage.id,
                user.organizationId,
              );
            if (!result.changes)
              throw new DealError(
                404,
                "NOT_FOUND",
                "A pipeline stage was not found.",
              );
          } else
            database
              .prepare(
                "INSERT INTO pipeline_stages(id,organization_id,name,position,color,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
              )
              .run(
                randomUUID(),
                user.organizationId,
                stage.name,
                stage.position,
                stage.color,
                stage.active ? 1 : 0,
                now,
                now,
              );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json({ updated: true });
    } catch (error) {
      sendError(error, response);
    }
  });

  router.get("/", async (request, response) => {
    try {
      const user = await principal(request);
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize) || 20),
      );
      const where = ["d.organization_id=?"],
        values: SQLInputValue[] = [user.organizationId];
      if (request.query.archived !== "true")
        where.push("d.archived_at IS NULL");
      for (const [query, column] of [
        ["stageId", "d.stage_id"],
        ["status", "d.status"],
        ["ownerId", "d.owner_id"],
        ["companyId", "d.company_id"],
        ["currency", "d.currency"],
      ] as const)
        if (typeof request.query[query] === "string" && request.query[query]) {
          where.push(`${column}=?`);
          values.push(request.query[query]);
        }
      if (typeof request.query.q === "string" && request.query.q.trim()) {
        where.push("(d.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
        const q = `%${request.query.q.trim().replace(/[\\%_]/gu, "\\$&")}%`;
        values.push(q, q);
      }
      if (
        typeof request.query.closeFrom === "string" &&
        /^\d{4}-\d{2}-\d{2}$/u.test(request.query.closeFrom)
      ) {
        where.push("d.expected_close_date>=?");
        values.push(request.query.closeFrom);
      }
      if (
        typeof request.query.closeTo === "string" &&
        /^\d{4}-\d{2}-\d{2}$/u.test(request.query.closeTo)
      ) {
        where.push("d.expected_close_date<=?");
        values.push(request.query.closeTo);
      }
      const clause = where.join(" AND ");
      const total = Number(
        (
          database
            .prepare(
              `SELECT count(*) total FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id WHERE ${clause}`,
            )
            .get(...values) as Row
        ).total,
      );
      const rows = database
        .prepare(
          `${selectDeal} WHERE ${clause} ORDER BY ${{ name: "d.name", amount: "d.amount_minor", closeDate: "d.expected_close_date", updated: "d.updated_at", stage: "s.position" }[String(request.query.sort)] ?? "s.position"} ${request.query.direction === "desc" ? "DESC" : "ASC"},d.id ${request.query.direction === "desc" ? "DESC" : "ASC"} LIMIT ? OFFSET ?`,
        )
        .all(...values, pageSize, (page - 1) * pageSize) as Row[];
      const stages = database
        .prepare(
          "SELECT id,name,position,color FROM pipeline_stages WHERE organization_id=? AND is_active=1 ORDER BY position,id",
        )
        .all(user.organizationId) as Row[];
      response.json({
        items: rows.map(dealJson),
        stages: stages.map((s) => ({
          id: String(s.id),
          name: String(s.name),
          position: Number(s.position),
          color: String(s.color),
          deals: rows.filter((r) => r.stage_id === s.id).map(dealJson),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      sendError(error, response);
    }
  });

  router.get("/:id", async (request, response) => {
    try {
      const user = await principal(request);
      const row = locate(request.params.id, user);
      if (!row)
        throw new DealError(
          404,
          "NOT_FOUND",
          "The requested deal was not found.",
        );
      const contacts = database
        .prepare(
          "SELECT c.id,c.first_name,c.last_name FROM deal_contacts dc JOIN contacts c ON c.id=dc.contact_id AND c.organization_id=dc.organization_id WHERE dc.organization_id=? AND dc.deal_id=? ORDER BY c.last_name,c.first_name,c.id",
        )
        .all(user.organizationId, request.params.id) as Row[];
      const history = database
        .prepare(
          "SELECT h.*,f.name from_name,t.name to_name,u.display_name actor_name FROM deal_stage_history h LEFT JOIN pipeline_stages f ON f.id=h.from_stage_id JOIN pipeline_stages t ON t.id=h.to_stage_id JOIN users u ON u.id=h.actor_id WHERE h.organization_id=? AND h.deal_id=? ORDER BY h.occurred_at DESC,h.id DESC",
        )
        .all(user.organizationId, request.params.id) as Row[];
      response.json({
        ...dealJson(row),
        contacts: contacts.map((c) => ({
          id: String(c.id),
          name: `${String(c.first_name)} ${String(c.last_name)}`,
        })),
        stageHistory: history.map((h) => ({
          from: h.from_stage_id
            ? { id: String(h.from_stage_id), name: String(h.from_name) }
            : null,
          to: { id: String(h.to_stage_id), name: String(h.to_name) },
          actor: String(h.actor_name),
          occurredAt: String(h.occurred_at),
        })),
      });
    } catch (error) {
      sendError(error, response);
    }
  });

  router.post("/", async (request, response) => {
    try {
      const user = await mutation(request);
      const value = parseDeal(request.body as Record<string, unknown>);
      verify(user, value);
      const id = randomUUID(),
        now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "INSERT INTO deals(id,organization_id,name,company_id,owner_id,amount_minor,currency,expected_close_date,probability,stage_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'open',?,?)",
          )
          .run(
            id,
            user.organizationId,
            value.name,
            value.companyId,
            value.ownerId,
            value.amountMinor,
            value.currency,
            value.expectedCloseDate,
            value.probability,
            value.stageId,
            now,
            now,
          );
        for (const contactId of value.contactIds)
          database
            .prepare(
              "INSERT INTO deal_contacts(organization_id,deal_id,contact_id,created_at) VALUES(?,?,?,?)",
            )
            .run(user.organizationId, id, contactId, now);
        database
          .prepare(
            "INSERT INTO deal_stage_history(id,organization_id,deal_id,from_stage_id,to_stage_id,actor_id,occurred_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            user.organizationId,
            id,
            null,
            value.stageId,
            user.userId,
            now,
          );
        audit(
          user,
          "deal.created",
          id,
          {
            name: value.name,
            amountMinor: value.amountMinor,
            currency: value.currency,
          },
          String(response.locals.requestId),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.status(201).json(dealJson(locate(id, user)!));
    } catch (error) {
      sendError(error, response);
    }
  });

  router.put("/:id", async (request, response) => {
    try {
      const user = await mutation(request);
      if (!locate(request.params.id, user))
        throw new DealError(
          404,
          "NOT_FOUND",
          "The requested deal was not found.",
        );
      const value = parseDeal(request.body as Record<string, unknown>);
      verify(user, value);
      const version = Number(request.body.version);
      if (!Number.isInteger(version))
        throw new DealError(
          400,
          "VALIDATION",
          "The record version is required.",
        );
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database
          .prepare(
            "UPDATE deals SET name=?,company_id=?,owner_id=?,amount_minor=?,currency=?,expected_close_date=?,probability=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(
            value.name,
            value.companyId,
            value.ownerId,
            value.amountMinor,
            value.currency,
            value.expectedCloseDate,
            value.probability,
            now,
            request.params.id,
            user.organizationId,
            version,
          );
        if (!result.changes)
          throw new DealError(
            409,
            "EDIT_CONFLICT",
            "This deal changed. Refresh and compare before saving.",
          );
        database
          .prepare(
            "DELETE FROM deal_contacts WHERE organization_id=? AND deal_id=?",
          )
          .run(user.organizationId, request.params.id);
        for (const contactId of value.contactIds)
          database
            .prepare("INSERT INTO deal_contacts VALUES(?,?,?,?)")
            .run(user.organizationId, request.params.id, contactId, now);
        audit(
          user,
          "deal.updated",
          request.params.id,
          { fields: Object.keys(request.body) },
          String(response.locals.requestId),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json(dealJson(locate(request.params.id, user)!));
    } catch (error) {
      sendError(error, response);
    }
  });

  router.post("/:id/transition", async (request, response) => {
    try {
      const user = await mutation(request);
      const row = locate(request.params.id, user);
      if (!row)
        throw new DealError(
          404,
          "NOT_FOUND",
          "The requested deal was not found.",
        );
      const stageId = clean(request.body.stageId, 100),
        status = clean(request.body.status ?? "open", 20),
        lossReason = optional(request.body.lossReason, 500),
        version = Number(request.body.version);
      if (
        !["open", "won", "lost"].includes(status) ||
        (status === "lost" && !lossReason) ||
        (status !== "lost" && lossReason)
      )
        throw new DealError(
          400,
          "VALIDATION",
          "Lost deals require a reason; open and won deals cannot have one.",
        );
      if (
        !database
          .prepare(
            "SELECT 1 FROM pipeline_stages WHERE id=? AND organization_id=? AND is_active=1",
          )
          .get(stageId, user.organizationId)
      )
        throw new DealError(
          400,
          "VALIDATION",
          "Choose an active pipeline stage.",
        );
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database
          .prepare(
            "UPDATE deals SET stage_id=?,status=?,loss_reason=?,probability=CASE WHEN ?='won' THEN 100 WHEN ?='lost' THEN 0 ELSE probability END,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
          )
          .run(
            stageId,
            status,
            lossReason,
            status,
            status,
            now,
            request.params.id,
            user.organizationId,
            version,
          );
        if (!result.changes)
          throw new DealError(
            409,
            "EDIT_CONFLICT",
            "This deal changed. Refresh the pipeline before moving it.",
          );
        database
          .prepare("INSERT INTO deal_stage_history VALUES(?,?,?,?,?,?,?)")
          .run(
            randomUUID(),
            user.organizationId,
            request.params.id,
            String(row.stage_id),
            stageId,
            user.userId,
            now,
          );
        audit(
          user,
          "deal.transitioned",
          request.params.id,
          { fromStageId: row.stage_id, toStageId: stageId, status },
          String(response.locals.requestId),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json(dealJson(locate(request.params.id, user)!));
    } catch (error) {
      sendError(error, response);
    }
  });

  router.post("/:id/:action", async (request, response) => {
    try {
      const user = await mutation(request);
      if (!["archive", "restore"].includes(request.params.action))
        throw new DealError(
          404,
          "NOT_FOUND",
          "The requested action was not found.",
        );
      if (!locate(request.params.id, user))
        throw new DealError(
          404,
          "NOT_FOUND",
          "The requested deal was not found.",
        );
      const now = new Date().toISOString(),
        archived = request.params.action === "archive" ? now : null;
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "UPDATE deals SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?",
          )
          .run(archived, now, request.params.id, user.organizationId);
        audit(
          user,
          `deal.${request.params.action}d`,
          request.params.id,
          {},
          String(response.locals.requestId),
          now,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      response.json(dealJson(locate(request.params.id, user)!));
    } catch (error) {
      sendError(error, response);
    }
  });
  return router;
}
