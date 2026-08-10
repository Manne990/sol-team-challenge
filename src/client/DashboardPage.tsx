import { useEffect, useState } from "react";
import {
  DataTable,
  FilterBar,
  OperationalState,
  PageHeader,
  StatusBadge,
  TextInput,
} from "./components/ui";

type Money = { currency: string; amountMinor: number; count: number };
type Dashboard = {
  asOf: string;
  semantics: Record<string, string>;
  pipeline: {
    values: Money[];
    link: string;
    stages: Array<{
      id: string;
      name: string;
      color: string;
      count: number;
      values: Money[];
    }>;
  };
  wonLostTrend: {
    items: Array<{
      day: string;
      status: string;
      count: number;
      currency: string;
      amountMinor: number;
    }>;
    link: string;
  };
  recentActivities: {
    items: Array<{
      id: string;
      type: string;
      subject: string;
      occurredAt: string;
      creatorName: string;
    }>;
    link: string;
  };
  tasks: {
    overdue: number;
    upcoming: number;
    overdueLink: string;
    upcomingLink: string;
  };
  closingSoon: {
    items: Array<{
      id: string;
      name: string;
      expectedCloseDate: string;
      amountMinor: number;
      currency: string;
    }>;
    link: string;
  };
  staleAccounts: {
    items: Array<{ id: string; name: string; lastActivityAt: string | null }>;
    link: string;
  };
};
const money = (value: Money | { currency: string; amountMinor: number }) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: 0,
  }).format(value.amountMinor / 100);

export function DashboardPage({
  navigate,
}: {
  navigate: (href: string) => void;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Dashboard>;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setError(true);
      });
    return () => controller.abort();
  }, []);
  if (error) return <OperationalState kind="error" />;
  if (!data)
    return (
      <OperationalState
        kind="loading"
        message="Calculating current CRM evidence…"
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={`As of ${new Date(data.asOf).toLocaleString()}`}
        title="Dashboard"
        description="Evidence-derived sales, relationship, and follow-up signals."
      />
      <FilterBar activeCount={0}>
        <label className="ns-field">
          <span>Search the CRM</span>
          <TextInput
            type="search"
            placeholder="Company, contact, deal or task"
            onKeyDown={(event) => {
              if (event.key === "Enter")
                navigate(
                  `/search?q=${encodeURIComponent(event.currentTarget.value)}`,
                );
            }}
          />
        </label>
      </FilterBar>
      <section className="ns-metrics" aria-label="Key metrics">
        <a className="ns-metric" href={data.pipeline.link}>
          <span>Open pipeline</span>
          <strong>
            {data.pipeline.values.length
              ? data.pipeline.values.map(money).join(" · ")
              : "No open value"}
          </strong>
          <small>
            {data.pipeline.values.reduce((sum, item) => sum + item.count, 0)}{" "}
            opportunities
          </small>
        </a>
        <a className="ns-metric" href={data.tasks.overdueLink}>
          <span>Overdue work</span>
          <strong>{data.tasks.overdue}</strong>
          <small>Due before now</small>
        </a>
        <a className="ns-metric" href={data.tasks.upcomingLink}>
          <span>Upcoming work</span>
          <strong>{data.tasks.upcoming}</strong>
          <small>Next 7 days</small>
        </a>
        <a className="ns-metric" href={data.closingSoon.link}>
          <span>Closing soon</span>
          <strong>{data.closingSoon.items.length}</strong>
          <small>Next 30 days</small>
        </a>
        <a className="ns-metric" href={data.staleAccounts.link}>
          <span>Stale accounts</span>
          <strong>{data.staleAccounts.items.length}</strong>
          <small>No activity in 30 days</small>
        </a>
      </section>
      <section className="ns-dashboard-grid">
        <article>
          <h2>Pipeline by stage</h2>
          {data.pipeline.stages.length ? (
            <ul className="ns-stage-distribution">
              {data.pipeline.stages.map((stage) => (
                <li key={stage.id}>
                  <span
                    className="ns-stage-dot"
                    style={{ background: stage.color }}
                  />
                  <a href={`/deals?status=open&stageId=${stage.id}`}>
                    {stage.name}
                  </a>
                  <strong>{stage.count}</strong>
                  <small>
                    {stage.values.map(money).join(" · ") || "No value"}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No active stages.</p>
          )}
        </article>
        <article>
          <h2>Won / lost trend</h2>
          {data.wonLostTrend.items.length ? (
            <ul className="ns-compact-list">
              {data.wonLostTrend.items.map((item) => (
                <li key={`${item.day}-${item.status}-${item.currency}`}>
                  <time dateTime={item.day}>{item.day}</time>{" "}
                  <StatusBadge
                    tone={item.status === "won" ? "positive" : "danger"}
                  >
                    {item.status}
                  </StatusBadge>{" "}
                  {item.count} · {money(item)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No won or lost deals in the trailing 90 days.</p>
          )}
        </article>
      </section>
      <section className="ns-dashboard-grid">
        <article>
          <h2>
            <a href={data.recentActivities.link}>Recent activity</a>
          </h2>
          {data.recentActivities.items.length ? (
            <DataTable
              caption="Recent activities"
              columns={["Subject", "Type", "By", "Occurred"]}
            >
              {data.recentActivities.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.subject}</td>
                  <td>{item.type}</td>
                  <td>{item.creatorName}</td>
                  <td>
                    <time dateTime={item.occurredAt}>
                      {new Date(item.occurredAt).toLocaleString()}
                    </time>
                  </td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <p>No activity recorded yet.</p>
          )}
        </article>
        <article>
          <h2>
            <a href={data.closingSoon.link}>Closing soon</a>
          </h2>
          {data.closingSoon.items.length ? (
            <ul className="ns-compact-list">
              {data.closingSoon.items.map((item) => (
                <li key={item.id}>
                  <a href={`/deals/${item.id}`}>{item.name}</a>{" "}
                  <strong>{money(item)}</strong>
                  <time dateTime={item.expectedCloseDate}>
                    {item.expectedCloseDate}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p>No opportunities close in the next 30 days.</p>
          )}
          <h2>
            <a href={data.staleAccounts.link}>Stale accounts</a>
          </h2>
          {data.staleAccounts.items.length ? (
            <ul className="ns-compact-list">
              {data.staleAccounts.items.map((item) => (
                <li key={item.id}>
                  <a href={`/companies/${item.id}`}>{item.name}</a>
                  <small>
                    {item.lastActivityAt
                      ? `Last activity ${new Date(item.lastActivityAt).toLocaleDateString()}`
                      : "No activity"}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No stale accounts.</p>
          )}
        </article>
      </section>
    </>
  );
}
