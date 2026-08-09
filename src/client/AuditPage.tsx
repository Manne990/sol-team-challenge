import { useCallback, useEffect, useState } from "react";
import type { UserRole } from "./components";
import {
  Button,
  OperationalState,
  PageHeader,
  Select,
  TextInput,
} from "./components";
type Event = {
  id: string;
  actor: { id: string; name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string;
  summary: Record<string, unknown>;
  createdAt: string;
};
export function AuditPage({ role }: { role: UserRole }) {
  const [items, setItems] = useState<Event[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [action, setAction] = useState(""),
    [entityType, setEntityType] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (action) query.set("action", action);
      if (entityType) query.set("entityType", entityType);
      const response = await fetch(`/api/governance/audit?${query}`),
        body = (await response.json()) as {
          items?: Event[];
          error?: { message: string };
        };
      if (!response.ok || !body.items)
        throw new Error(body.error?.message ?? "Audit could not be loaded.");
      setItems(body.items);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Audit could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [action, entityType]);
  useEffect(() => {
    if (role === "owner") void load();
    else setBusy(false);
  }, [load, role]);
  if (role !== "owner")
    return (
      <OperationalState
        kind="forbidden"
        message="Only organization owners can inspect audit history."
      />
    );
  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Audit"
        description="Append-only authentication, access, import, merge, and CRM change history."
      />
      <section className="ns-notification-controls" aria-label="Audit filters">
        <label className="ns-field">
          <span>Action</span>
          <TextInput
            value={action}
            placeholder="e.g. company.updated"
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        <label className="ns-field">
          <span>Entity type</span>
          <Select
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
          >
            <option value="">All entities</option>
            {[
              "authentication",
              "organization",
              "membership",
              "company",
              "contact",
              "activity",
              "deal",
              "task",
              "import",
              "merge",
            ].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setAction("");
            setEntityType("");
          }}
        >
          Clear
        </Button>
      </section>
      {error && (
        <div className="ns-inline-error" role="alert">
          {error}
        </div>
      )}
      {busy ? (
        <OperationalState kind="loading" />
      ) : items.length === 0 ? (
        <OperationalState
          kind="empty"
          title="No audit events"
          message="No events match these filters."
        />
      ) : (
        <div
          className="ns-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Audit events, scrollable"
        >
          <table className="ns-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Safe summary</th>
                <th scope="col">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </td>
                  <td>{item.actor?.name ?? "System"}</td>
                  <td>
                    <code>{item.action}</code>
                  </td>
                  <td>
                    {item.entityType}
                    {item.entityId && (
                      <>
                        <br />
                        <small>{item.entityId}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <code>{JSON.stringify(item.summary)}</code>
                  </td>
                  <td>
                    <small>{item.correlationId}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
