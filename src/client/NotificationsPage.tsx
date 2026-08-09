import { useCallback, useEffect, useState } from "react";
import {
  Button,
  OperationalState,
  PageHeader,
  Select,
  StatusBadge,
} from "./components";

type Item = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  readAt: string | null;
};
type Result = {
  items: Item[];
  total: number;
  unread: number;
  page: number;
  pages: number;
};
const labels: Record<string, string> = {
  task_assignment: "Task assignment",
  task_due_soon: "Due soon",
  task_overdue: "Overdue",
  deal_assignment: "Deal assignment",
  deal_stage_changed: "Deal change",
};

export function NotificationsPage() {
  const [result, setResult] = useState<Result | null>(null),
    [unreadOnly, setUnreadOnly] = useState(false),
    [type, setType] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (unreadOnly) query.set("unread", "true");
      if (type) query.set("type", type);
      const response = await fetch(`/api/notifications?${query}`);
      const body = (await response.json()) as Result & {
        error?: { message: string };
      };
      if (!response.ok)
        throw new Error(
          body.error?.message ?? "Notifications could not be loaded.",
        );
      setResult(body);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Notifications could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [type, unreadOnly]);
  useEffect(() => {
    void load();
  }, [load]);
  const mutate = async (path: string, method = "POST") => {
    setError("");
    try {
      const response = await fetch(path, { method });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message: string } };
        throw new Error(
          body.error?.message ?? "Notification could not be updated.",
        );
      }
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Notification could not be updated.",
      );
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Personal inbox"
        title="Notifications"
        description="Assignments, approaching work, overdue tasks, and important deal changes."
        actions={
          result?.unread ? (
            <Button
              variant="secondary"
              onClick={() => void mutate("/api/notifications/read-all")}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <section
        className="ns-notification-controls"
        aria-label="Notification filters"
      >
        <label className="ns-field">
          <span>Show</span>
          <Select
            value={unreadOnly ? "unread" : "all"}
            onChange={(event) => setUnreadOnly(event.target.value === "unread")}
          >
            <option value="all">All notifications</option>
            <option value="unread">Unread only</option>
          </Select>
        </label>
        <label className="ns-field">
          <span>Type</span>
          <Select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All types</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {result && (
          <p>
            <strong>{result.unread}</strong> unread
          </p>
        )}
      </section>
      {error && (
        <div className="ns-inline-error" role="alert">
          {error}
        </div>
      )}
      {busy && !result ? (
        <OperationalState
          kind="loading"
          message="Loading your notifications…"
        />
      ) : result?.items.length === 0 ? (
        <OperationalState
          kind="empty"
          title="You’re all caught up"
          message="No notifications match these filters."
        />
      ) : (
        <ol className="ns-notification-list">
          {result?.items.map((item) => (
            <li key={item.id} className={item.readAt ? "is-read" : "is-unread"}>
              <div className="ns-notification-marker" aria-hidden="true" />
              <div>
                <div className="ns-notification-meta">
                  <StatusBadge
                    tone={
                      item.type === "task_overdue"
                        ? "danger"
                        : item.type === "task_due_soon"
                          ? "warning"
                          : "info"
                    }
                  >
                    {labels[item.type] ?? item.type}
                  </StatusBadge>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </time>
                </div>
                <h2>
                  {item.href ? (
                    <a href={item.href}>{item.title}</a>
                  ) : (
                    item.title
                  )}
                </h2>
                <p>{item.body}</p>
              </div>
              {!item.readAt && (
                <Button
                  variant="quiet"
                  onClick={() =>
                    void mutate(`/api/notifications/${item.id}/read`, "PATCH")
                  }
                >
                  Mark read
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
