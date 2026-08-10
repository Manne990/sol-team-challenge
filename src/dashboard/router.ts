import type { DatabaseSync } from "node:sqlite";
import { Router, type Request } from "express";
import { readSessionCookie } from "../auth/http.js";
import { AuthService } from "../auth/service.js";
import { SqliteAuthRepository } from "../auth/sqlite-repository.js";

type Row = Record<string, unknown>;
const values = (rows: Row[]) =>
  rows.map((row) => ({
    currency: String(row.currency),
    amountMinor: Number(row.amount_minor),
    count: Number(row.count),
  }));
const plusDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000).toISOString();

export function createDashboardRouter(
  database: DatabaseSync,
  clock: () => Date = () => new Date(),
) {
  const router = Router();
  const auth = new AuthService(new SqliteAuthRepository(database));
  const principal = (request: Request) =>
    auth.authenticate(readSessionCookie(request.header("cookie")));
  router.get("/", async (request, response, next) => {
    try {
      const user = await principal(request);
      const now = clock();
      const nowIso = now.toISOString();
      const today = nowIso.slice(0, 10);
      const upcoming = plusDays(now, 7);
      const closing = plusDays(now, 30).slice(0, 10);
      const trendStart = plusDays(now, -90);
      const staleSince = plusDays(now, -30);
      const pipelineRows = database
        .prepare(
          "SELECT currency,sum(amount_minor) amount_minor,count(*) count FROM deals WHERE organization_id=? AND archived_at IS NULL AND status='open' GROUP BY currency ORDER BY currency",
        )
        .all(user.organizationId) as Row[];
      const stageRows = database
        .prepare(
          "SELECT s.id,s.name,s.position,s.color,d.currency,coalesce(sum(d.amount_minor),0) amount_minor,count(d.id) count FROM pipeline_stages s LEFT JOIN deals d ON d.stage_id=s.id AND d.organization_id=s.organization_id AND d.archived_at IS NULL AND d.status='open' WHERE s.organization_id=? AND s.is_active=1 GROUP BY s.id,s.name,s.position,s.color,d.currency ORDER BY s.position,s.id,d.currency",
        )
        .all(user.organizationId) as Row[];
      const stages = [...new Set(stageRows.map((row) => String(row.id)))].map(
        (id) => {
          const group = stageRows.filter((row) => row.id === id);
          const first = group[0]!;
          return {
            id,
            name: String(first.name),
            position: Number(first.position),
            color: String(first.color),
            count: group.reduce((sum, row) => sum + Number(row.count), 0),
            values: values(group.filter((row) => row.currency !== null)),
          };
        },
      );
      const trends = database
        .prepare(
          "SELECT substr(updated_at,1,10) day,status,count(*) count,currency,sum(amount_minor) amount_minor FROM deals WHERE organization_id=? AND archived_at IS NULL AND status IN ('won','lost') AND updated_at>=? GROUP BY day,status,currency ORDER BY day,status,currency",
        )
        .all(user.organizationId, trendStart) as Row[];
      const activities = database
        .prepare(
          "SELECT id,type,subject,occurred_at,creator_name_snapshot,company_id,company_name_snapshot,contact_id,contact_name_snapshot,deal_id,deal_name_snapshot FROM activities WHERE organization_id=? ORDER BY occurred_at DESC,id DESC LIMIT 10",
        )
        .all(user.organizationId) as Row[];
      const taskCounts = database
        .prepare(
          "SELECT sum(CASE WHEN status!='completed' AND archived_at IS NULL AND due_at<? THEN 1 ELSE 0 END) overdue,sum(CASE WHEN status!='completed' AND archived_at IS NULL AND due_at>=? AND due_at<? THEN 1 ELSE 0 END) upcoming FROM tasks WHERE organization_id=?",
        )
        .get(nowIso, nowIso, upcoming, user.organizationId) as Row;
      const closingDeals = database
        .prepare(
          "SELECT id,name,expected_close_date,amount_minor,currency FROM deals WHERE organization_id=? AND archived_at IS NULL AND status='open' AND expected_close_date>=? AND expected_close_date<=? ORDER BY expected_close_date,id LIMIT 10",
        )
        .all(user.organizationId, today, closing) as Row[];
      const stale = database
        .prepare(
          "SELECT c.id,c.name,max(a.occurred_at) last_activity_at FROM companies c LEFT JOIN activities a ON a.organization_id=c.organization_id AND a.company_id=c.id WHERE c.organization_id=? AND c.archived_at IS NULL AND c.lifecycle_status IN ('prospect','customer') GROUP BY c.id,c.name HAVING max(a.occurred_at) IS NULL OR max(a.occurred_at)<? ORDER BY last_activity_at,c.name,c.id LIMIT 10",
        )
        .all(user.organizationId, staleSince) as Row[];
      response.json({
        asOf: nowIso,
        semantics: {
          pipeline: "Open, non-archived deals grouped by currency",
          trend: "Won and lost deals updated in the trailing 90 days",
          upcomingTasks: "Open work due from now through the next 7 days",
          closingSoon:
            "Open deals expected to close in the next 30 calendar days",
          staleAccounts:
            "Active prospects and customers without activity in the trailing 30 days",
        },
        pipeline: {
          values: values(pipelineRows),
          link: "/deals?status=open",
          stages,
        },
        wonLostTrend: {
          items: trends.map((row) => ({
            day: String(row.day),
            status: String(row.status),
            count: Number(row.count),
            currency: String(row.currency),
            amountMinor: Number(row.amount_minor),
          })),
          link: `/deals?status=won&updatedFrom=${trendStart}`,
        },
        recentActivities: {
          items: activities.map((row) => ({
            id: String(row.id),
            type: String(row.type),
            subject: String(row.subject),
            occurredAt: String(row.occurred_at),
            creatorName: String(row.creator_name_snapshot),
            company: row.company_id
              ? {
                  id: String(row.company_id),
                  name: String(row.company_name_snapshot),
                }
              : null,
            contact: row.contact_id
              ? {
                  id: String(row.contact_id),
                  name: String(row.contact_name_snapshot),
                }
              : null,
            deal: row.deal_id
              ? {
                  id: String(row.deal_id),
                  name: String(row.deal_name_snapshot),
                }
              : null,
          })),
          link: "/activities",
        },
        tasks: {
          overdue: Number(taskCounts.overdue ?? 0),
          upcoming: Number(taskCounts.upcoming ?? 0),
          overdueLink: "/tasks?view=overdue",
          upcomingLink: "/tasks?view=upcoming",
        },
        closingSoon: {
          items: closingDeals.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            expectedCloseDate: String(row.expected_close_date),
            amountMinor: Number(row.amount_minor),
            currency: String(row.currency),
          })),
          link: `/deals?status=open&closeFrom=${today}&closeTo=${closing}`,
        },
        staleAccounts: {
          items: stale.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            lastActivityAt: row.last_activity_at
              ? String(row.last_activity_at)
              : null,
          })),
          link: `/companies?lifecycle=customer&staleBefore=${staleSince}`,
        },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
