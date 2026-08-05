import { Router, type Request } from "express";
import { AuthService } from "./auth/service.js";
import { readCookie, SESSION_COOKIE } from "./auth/session.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";

type Row = Record<string, unknown>;
const DAY = 86_400_000;
const moneyRows = (rows: Row[]) =>
  rows.map((row) => ({
    currency: String(row.currency),
    amountMinor: Number(row.amount_minor ?? 0),
    count: Number(row.count ?? 0),
  }));

export function dashboardRouter(
  db: SqliteDatabase,
  auth: AuthService,
  clock = () => new Date(),
) {
  const router = Router();
  const actor = async (request: Request) =>
    auth.requireRole(
      await auth.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      ),
      ["owner", "member", "viewer"],
    );

  router.get("/", async (request, response, next) => {
    try {
      const user = await actor(request);
      const org = user.organization.id;
      const now = clock();
      const nowIso = now.toISOString();
      const today = nowIso.slice(0, 10);
      const upcomingEnd = new Date(now.getTime() + 7 * DAY).toISOString();
      const closingEnd = new Date(now.getTime() + 30 * DAY)
        .toISOString()
        .slice(0, 10);
      const staleCutoff = new Date(now.getTime() - 30 * DAY).toISOString();
      const trendCutoff = new Date(now.getTime() - 90 * DAY).toISOString();

      const openPipeline = moneyRows(
        db
          .prepare(
            `SELECT currency,count(*) count,coalesce(sum(amount_minor),0) amount_minor FROM deals
             WHERE organization_id=? AND archived_at IS NULL AND status='open' GROUP BY currency ORDER BY currency`,
          )
          .all(org) as Row[],
      );
      const stageDistribution = (
        db
          .prepare(
            `SELECT s.id stage_id,s.name,s.color,s.position,d.currency,count(d.id) count,
              coalesce(sum(d.amount_minor),0) amount_minor
             FROM pipeline_stages s LEFT JOIN deals d ON d.stage_id=s.id AND d.organization_id=s.organization_id
               AND d.archived_at IS NULL AND d.status='open'
             WHERE s.organization_id=? AND s.active=1
             GROUP BY s.id,s.name,s.color,s.position,d.currency ORDER BY s.position,s.id,d.currency`,
          )
          .all(org) as Row[]
      ).map((row) => ({
        stageId: String(row.stage_id),
        name: String(row.name),
        color: String(row.color),
        position: Number(row.position),
        currency: row.currency === null ? null : String(row.currency),
        count: Number(row.count),
        amountMinor: Number(row.amount_minor),
        href: `#deals?status=open&stageId=${encodeURIComponent(String(row.stage_id))}`,
      }));
      const wonLostTrend = (
        db
          .prepare(
            `SELECT status,currency,count(*) count,coalesce(sum(amount_minor),0) amount_minor
             FROM deals WHERE organization_id=? AND archived_at IS NULL AND status IN ('won','lost') AND updated_at>=?
             GROUP BY status,currency ORDER BY status,currency`,
          )
          .all(org, trendCutoff) as Row[]
      ).map((row) => ({
        status: String(row.status),
        currency: String(row.currency),
        count: Number(row.count),
        amountMinor: Number(row.amount_minor),
        href: `#deals?status=${String(row.status)}&updatedFrom=${encodeURIComponent(trendCutoff)}`,
      }));
      const taskCounts = db
        .prepare(
          `SELECT
            sum(CASE WHEN status='open' AND due_at<? THEN 1 ELSE 0 END) overdue,
            sum(CASE WHEN status='open' AND due_at>=? AND due_at<? THEN 1 ELSE 0 END) upcoming
           FROM tasks WHERE organization_id=? AND archived_at IS NULL`,
        )
        .get(nowIso, nowIso, upcomingEnd, org) as Row;
      const closingSoon = moneyRows(
        db
          .prepare(
            `SELECT currency,count(*) count,coalesce(sum(amount_minor),0) amount_minor FROM deals
             WHERE organization_id=? AND archived_at IS NULL AND status='open'
               AND expected_close_date>=? AND expected_close_date<=?
             GROUP BY currency ORDER BY currency`,
          )
          .all(org, today, closingEnd) as Row[],
      );
      const stale = db
        .prepare(
          `SELECT c.id,c.name,max(a.occurred_at) last_activity_at FROM companies c
           LEFT JOIN activities a ON a.company_id=c.id AND a.organization_id=c.organization_id
           WHERE c.organization_id=? AND c.archived_at IS NULL
           GROUP BY c.id,c.name HAVING max(a.occurred_at) IS NULL OR max(a.occurred_at)<?
           ORDER BY last_activity_at,c.name,c.id`,
        )
        .all(org, staleCutoff) as Row[];
      const recentActivity = db
        .prepare(
          `SELECT a.id,a.type,a.subject,a.occurred_at,c.name company_name,
            coalesce(ct.first_name||' '||ct.last_name,'') contact_name
           FROM activities a LEFT JOIN companies c ON c.id=a.company_id AND c.organization_id=a.organization_id
           LEFT JOIN contacts ct ON ct.id=a.contact_id AND ct.organization_id=a.organization_id
           WHERE a.organization_id=? ORDER BY a.occurred_at DESC,a.id DESC LIMIT 8`,
        )
        .all(org) as Row[];

      response.json({
        generatedAt: nowIso,
        windows: {
          upcomingDays: 7,
          closingDays: 30,
          staleDays: 30,
          trendDays: 90,
        },
        openPipeline,
        stageDistribution,
        wonLostTrend,
        tasks: {
          overdue: Number(taskCounts.overdue ?? 0),
          upcoming: Number(taskCounts.upcoming ?? 0),
          overdueHref: "#tasks?view=overdue",
          upcomingHref: `#tasks?view=upcoming&dueBefore=${encodeURIComponent(upcomingEnd)}`,
        },
        closingSoon,
        closingSoonHref: `#deals?status=open&closeFrom=${today}&closeTo=${closingEnd}`,
        staleAccounts: {
          count: stale.length,
          items: stale.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            lastActivityAt:
              row.last_activity_at === null
                ? null
                : String(row.last_activity_at),
          })),
          href: `#companies?lastActivityBefore=${encodeURIComponent(staleCutoff)}`,
        },
        recentActivity: recentActivity.map((row) => ({
          id: String(row.id),
          type: String(row.type),
          subject: String(row.subject),
          occurredAt: String(row.occurred_at),
          companyName:
            row.company_name === null ? null : String(row.company_name),
          contactName: String(row.contact_name) || null,
          href: "#activities",
        })),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
