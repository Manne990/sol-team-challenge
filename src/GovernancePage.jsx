import React, { useEffect, useState } from "react";
import { Button, DataTable, OperationalState } from "./components.jsx";

async function request(path, options) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-northstar-ui-request": "true",
    },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error)
    throw new Error(
      body?.error?.message || "Could not complete the governance request.",
    );
  return body;
}
const auditColumns = [
  {
    key: "createdAt",
    label: "Time",
    render: (x) => new Date(x.createdAt).toLocaleString(),
  },
  { key: "actor", label: "Actor", render: (x) => x.actor?.name || "System" },
  { key: "action", label: "Action" },
  { key: "entityType", label: "Entity" },
  { key: "entityId", label: "Record" },
  {
    key: "summary",
    label: "Safe change summary",
    render: (x) => <code>{JSON.stringify(x.summary)}</code>,
  },
];
export function AuditPage() {
  const [state, setState] = useState({ status: "loading" }),
    [filters, setFilters] = useState(
      () => new URLSearchParams(location.hash.split("?")[1] || ""),
    );
  const load = () => {
    setState({ status: "loading" });
    request(`/api/governance/audit?${filters}`)
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => setState({ status: "error", error }));
  };
  useEffect(load, [filters.toString()]);
  if (state.status === "loading") return <OperationalState type="loading" />;
  if (state.status !== "ready")
    return <OperationalState type="error" message={state.error?.message} />;
  const update = (key, value) => {
    const next = new URLSearchParams(filters);
    if (value) next.set(key, value);
    else next.delete(key);
    setFilters(next);
    location.hash = `audit?${next}`;
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Governance</p>
          <h1>Audit</h1>
          <p>
            {state.data.pagination.total} append-only events in your
            organization.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="filters governance-filters">
          <label>
            Action
            <input
              value={filters.get("action") || ""}
              onChange={(e) => update("action", e.target.value)}
              placeholder="deal.updated"
            />
          </label>
          <label>
            Entity type
            <input
              value={filters.get("entityType") || ""}
              onChange={(e) => update("entityType", e.target.value)}
              placeholder="deal"
            />
          </label>
          <label>
            From
            <input
              type="datetime-local"
              value={filters.get("from") || ""}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              setFilters(new URLSearchParams());
              location.hash = "audit";
            }}
          >
            Clear filters
          </button>
        </div>
        {state.data.events.length ? (
          <DataTable
            caption="Audit events"
            columns={auditColumns}
            rows={state.data.events}
          />
        ) : (
          <OperationalState type="empty" title="No audit events match" />
        )}
      </section>
    </>
  );
}
const blank = {
  email: "",
  firstName: "",
  lastName: "",
  password: "",
  role: "member",
};
export function AdministrationPage({ user }) {
  const [state, setState] = useState({ status: "loading" }),
    [form, setForm] = useState(blank),
    [error, setError] = useState("");
  const load = () =>
    Promise.all([
      request("/api/auth/members"),
      request("/api/governance/organization"),
    ])
      .then(([members, org]) =>
        setState({
          status: "ready",
          members: members.members,
          organization: org.organization,
        }),
      )
      .catch((error) => setState({ status: "error", error }));
  useEffect(() => {
    load();
  }, []);
  if (state.status === "loading") return <OperationalState type="loading" />;
  if (state.status !== "ready")
    return <OperationalState type="error" message={state.error?.message} />;
  const organization = state.organization;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Owner settings</p>
          <h1>Administration</h1>
          <p>Manage organization-safe settings, roles, and access.</p>
        </div>
      </div>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <section className="panel governance-settings">
        <div className="panel__heading">
          <h2>Organization settings</h2>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            try {
              const data = new FormData(event.currentTarget);
              await request("/api/governance/organization", {
                method: "PATCH",
                body: JSON.stringify({
                  version: organization.version,
                  name: data.get("name"),
                  settings: {
                    timezone: data.get("timezone"),
                    locale: data.get("locale"),
                    currency: data.get("currency"),
                  },
                }),
              });
              load();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label>
            Name
            <input name="name" required defaultValue={organization.name} />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              required
              defaultValue={organization.settings.timezone || "UTC"}
            />
          </label>
          <label>
            Locale
            <input
              name="locale"
              required
              defaultValue={organization.settings.locale || "en"}
            />
          </label>
          <label>
            Currency
            <input
              name="currency"
              required
              maxLength="3"
              defaultValue={organization.settings.currency || "USD"}
            />
          </label>
          <Button>Save settings</Button>
        </form>
      </section>
      <section className="panel">
        <div className="panel__heading">
          <h2>Active members</h2>
        </div>
        <div className="member-list">
          {state.members.map((member) => (
            <div key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <small>
                  {member.email}
                  {member.id === user?.membershipId ? " · You" : ""}
                </small>
              </div>
              <label>
                Role
                <select
                  aria-label={`Role for ${member.name}`}
                  value={member.role}
                  disabled={member.id === user?.membershipId}
                  onChange={async (e) => {
                    try {
                      await request(`/api/auth/members/${member.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ role: e.target.value }),
                      });
                      load();
                    } catch (failure) {
                      setError(failure.message);
                    }
                  }}
                >
                  <option>owner</option>
                  <option>member</option>
                  <option>viewer</option>
                </select>
              </label>
              <Button
                variant="danger"
                disabled={member.id === user?.membershipId}
                onClick={async () => {
                  if (
                    !confirm(
                      `Revoke ${member.name}? Their active sessions will end immediately.`,
                    )
                  )
                    return;
                  try {
                    await request(`/api/auth/members/${member.id}`, {
                      method: "DELETE",
                    });
                    load();
                  } catch (failure) {
                    setError(failure.message);
                  }
                }}
              >
                Revoke access
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel governance-settings">
        <div className="panel__heading">
          <h2>Create member</h2>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            try {
              await request("/api/auth/members", {
                method: "POST",
                body: JSON.stringify(form),
              });
              setForm(blank);
              load();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          {["email", "firstName", "lastName", "password"].map((key) => (
            <label key={key}>
              {
                {
                  email: "Email",
                  firstName: "First name",
                  lastName: "Last name",
                  password: "Temporary password",
                }[key]
              }
              <input
                required
                type={
                  key === "password"
                    ? "password"
                    : key === "email"
                      ? "email"
                      : "text"
                }
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            Role
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option>owner</option>
              <option>member</option>
              <option>viewer</option>
            </select>
          </label>
          <Button>Create member</Button>
        </form>
      </section>
    </>
  );
}
