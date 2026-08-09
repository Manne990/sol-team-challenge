import React, { useEffect, useState } from "react";
import { Button, OperationalState } from "./components.jsx";

const money = (amount, currency) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount / 100);
const totals = (rows) =>
  rows.length
    ? rows
        .map(
          (row) =>
            `${money(row.amountMinor, row.currency)} · ${row.count} deal${row.count === 1 ? "" : "s"}`,
        )
        .join(" | ")
    : "No matching deals";

export function DashboardPage() {
  const [state, setState] = useState({ status: "loading" });
  const load = async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/dashboard", {
          credentials: "same-origin",
        }),
        body = await response.json();
      if (!response.ok)
        throw new Error(body?.error?.message || "Dashboard unavailable");
      setState({ status: "ready", data: body });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Dashboard unavailable",
      });
    }
  };
  useEffect(() => {
    load();
  }, []);
  if (state.status === "loading")
    return <OperationalState type="loading" title="Calculating dashboard" />;
  if (state.status === "error")
    return (
      <OperationalState
        type="error"
        message={state.message}
        action={
          <Button variant="quiet" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  const data = state.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            Evidence as of {new Date(data.generatedAt).toLocaleString()}
          </p>
          <h1>Dashboard</h1>
          <p>
            Operational metrics derived from your organization’s CRM records.
          </p>
        </div>
        <Button variant="quiet" onClick={load}>
          Refresh metrics
        </Button>
      </div>
      <section className="metrics dashboard-metrics" aria-label="CRM overview">
        <a className="metric" href="/deals?status=open">
          <span>Open pipeline</span>
          <strong>
            {data.openPipeline.reduce((sum, row) => sum + row.count, 0)} deals
          </strong>
          <small>{totals(data.openPipeline)} →</small>
        </a>
        <a className="metric" href={data.closingSoonHref}>
          <span>Closing in 30 days</span>
          <strong>
            {data.closingSoon.reduce((sum, row) => sum + row.count, 0)} deals
          </strong>
          <small>{totals(data.closingSoon)} →</small>
        </a>
        <a className="metric metric--alert" href={data.tasks.overdueHref}>
          <span>Overdue tasks</span>
          <strong>{data.tasks.overdue}</strong>
          <small>Due before this refresh →</small>
        </a>
        <a className="metric" href={data.tasks.upcomingHref}>
          <span>Upcoming tasks</span>
          <strong>{data.tasks.upcoming}</strong>
          <small>Next 7 × 24 hours →</small>
        </a>
        <a className="metric metric--alert" href={data.staleAccounts.href}>
          <span>Stale accounts</span>
          <strong>{data.staleAccounts.count}</strong>
          <small>No activity in 30 days →</small>
        </a>
      </section>
      <div className="dashboard-grid dashboard-grid--evidence">
        <MetricPanel
          title="Pipeline by stage"
          description="Open deals; currencies remain separate"
          empty="No open pipeline"
          rows={data.stageDistribution.filter((row) => row.count)}
          render={(row) => (
            <li key={`${row.stageId}-${row.currency}`}>
              <a href={row.href}>
                <i style={{ background: row.color }} />
                {row.name}
              </a>
              <strong>
                {row.currency ? money(row.amountMinor, row.currency) : "—"}
              </strong>
              <small>{row.count} deals</small>
            </li>
          )}
        />
        <MetricPanel
          title="Won and lost"
          description="Outcomes updated during the last 90 × 24 hours"
          empty="No recent outcomes"
          rows={data.wonLostTrend}
          render={(row) => (
            <li key={`${row.status}-${row.currency}`}>
              <a href={row.href}>{row.status === "won" ? "Won" : "Lost"}</a>
              <strong>{money(row.amountMinor, row.currency)}</strong>
              <small>{row.count} deals</small>
            </li>
          )}
        />
        <section className="panel dashboard-panel">
          <div className="panel__heading">
            <div>
              <h2>Recent activity</h2>
              <p>The eight most recently occurred entries</p>
            </div>
            <a href="/activities">View timeline →</a>
          </div>
          {data.recentActivity.length ? (
            <ol className="dashboard-feed">
              {data.recentActivity.map((item) => (
                <li key={item.id}>
                  <a href={item.href}>{item.subject}</a>
                  <span>
                    {item.type} ·{" "}
                    {item.companyName || item.contactName || "Unrelated"}
                  </span>
                  <time dateTime={item.occurredAt}>
                    {new Date(item.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <OperationalState type="empty" title="No activity yet" />
          )}
        </section>
        <section className="panel dashboard-panel">
          <div className="panel__heading">
            <div>
              <h2>Stale accounts</h2>
              <p>No company activity in the last 30 × 24 hours</p>
            </div>
            <a href={data.staleAccounts.href}>View filtered accounts →</a>
          </div>
          {data.staleAccounts.items.length ? (
            <ul className="dashboard-stale">
              {data.staleAccounts.items.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <a href={`/companies/${item.id}`}>{item.name}</a>
                  <span>
                    {item.lastActivityAt
                      ? `Last activity ${new Date(item.lastActivityAt).toLocaleDateString()}`
                      : "No recorded activity"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <OperationalState type="empty" title="Every account is active" />
          )}
        </section>
      </div>
      <p className="metric-method">
        <strong>Metric policy:</strong> overdue is due before refresh; upcoming
        ends after seven days; closing uses UTC dates through 30 days; stale
        means no company activity at or after the 30-day cutoff. Archived
        records are excluded.
      </p>
    </>
  );
}

function MetricPanel({ title, description, empty, rows, render }) {
  return (
    <section className="panel dashboard-panel">
      <div className="panel__heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {rows.length ? (
        <ul className="dashboard-values">{rows.map(render)}</ul>
      ) : (
        <OperationalState type="empty" title={empty} />
      )}
    </section>
  );
}
