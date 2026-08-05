import React, { useEffect, useState } from "react";
import { Button, DataTable, Dialog, OperationalState } from "./components.jsx";

const empty = {
  name: "",
  organizationNumber: "",
  externalReference: "",
  website: "",
  phone: "",
  industry: "",
  size: "small",
  address: "",
  lifecycleStatus: "lead",
  ownerMembershipId: "",
  tags: "",
  description: "",
};
const columns = [
  {
    key: "name",
    label: "Company",
    render: (row) => <a href={`#companies/${row.id}`}>{row.name}</a>,
  },
  { key: "lifecycleStatus", label: "Lifecycle" },
  { key: "industry", label: "Industry" },
  { key: "size", label: "Size" },
  { key: "ownerName", label: "Owner" },
  {
    key: "updatedAt",
    label: "Updated",
    render: (row) => new Date(row.updatedAt).toLocaleDateString(),
  },
];
async function api(path, options) {
  const response = await fetch(`/api/companies${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || "Could not complete the request.",
    );
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

function CompanyForm({ company, user, onSaved, onCancel }) {
  const [form, setForm] = useState(
      company
        ? {
            ...company,
            address: Object.values(company.address || {})
              .filter(Boolean)
              .join(", "),
            tags: (company.tags || []).join(", "),
          }
        : { ...empty, ownerMembershipId: user?.membershipId || "" },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        address: { formatted: form.address },
        tags: form.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        ownerMembershipId: form.ownerMembershipId || null,
      };
      const result = await api(company ? `/${company.id}` : "", {
        method: company ? "PATCH" : "POST",
        body: JSON.stringify(
          company ? { ...payload, version: company.version } : payload,
        ),
      });
      onSaved(result.company);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="company-form" onSubmit={submit}>
      <h2>{company ? "Edit company" : "Add company"}</h2>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <div className="company-form__grid">
        <label>
          Name *
          <input
            required
            maxLength="160"
            value={form.name}
            onChange={set("name")}
          />
        </label>
        <label>
          Organization number
          <input
            maxLength="80"
            value={form.organizationNumber || ""}
            onChange={set("organizationNumber")}
          />
        </label>
        <label>
          External reference
          <input
            maxLength="80"
            value={form.externalReference || ""}
            onChange={set("externalReference")}
          />
        </label>
        <label>
          Website
          <input
            type="url"
            maxLength="300"
            value={form.website || ""}
            onChange={set("website")}
          />
        </label>
        <label>
          Phone
          <input
            maxLength="60"
            value={form.phone || ""}
            onChange={set("phone")}
          />
        </label>
        <label>
          Industry
          <input
            maxLength="100"
            value={form.industry || ""}
            onChange={set("industry")}
          />
        </label>
        <label>
          Size
          <select value={form.size || ""} onChange={set("size")}>
            <option value="">Not set</option>
            <option>small</option>
            <option>medium</option>
            <option>large</option>
          </select>
        </label>
        <label>
          Lifecycle
          <select
            value={form.lifecycleStatus}
            onChange={set("lifecycleStatus")}
          >
            <option>lead</option>
            <option>prospect</option>
            <option>customer</option>
            <option>inactive</option>
          </select>
        </label>
        <label>
          Owner membership ID
          <input
            maxLength="100"
            value={form.ownerMembershipId || ""}
            onChange={set("ownerMembershipId")}
          />
        </label>
        <label className="wide">
          Address
          <input
            maxLength="300"
            value={form.address || ""}
            onChange={set("address")}
          />
        </label>
        <label className="wide">
          Tags, comma separated
          <input
            maxLength="400"
            value={form.tags || ""}
            onChange={set("tags")}
          />
        </label>
        <label className="wide">
          Description
          <textarea
            maxLength="5000"
            value={form.description || ""}
            onChange={set("description")}
          />
        </label>
      </div>
      <div className="form-actions">
        <Button variant="quiet" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save company"}
        </Button>
      </div>
    </form>
  );
}

export function CompaniesPage({ role, user, companyId }) {
  const [state, setState] = useState({ status: "loading" }),
    [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [filters, setFilters] = useState(
    () => new URLSearchParams(location.hash.split("?")[1] || ""),
  );
  const load = () => {
    setState({ status: "loading" });
    api(companyId ? `/${companyId}` : `?${filters}`)
      .then((data) =>
        setState({ status: "ready", data: companyId ? data.company : data }),
      )
      .catch((error) =>
        setState({
          status: error.code === "NOT_FOUND" ? "not-found" : "error",
          error,
        }),
      );
  };
  useEffect(load, [companyId, filters.toString()]);
  const canEdit = role !== "viewer";
  if (state.status === "loading") return <OperationalState type="loading" />;
  if (state.status !== "ready")
    return (
      <OperationalState type={state.status} message={state.error?.message} />
    );
  if (editing)
    return (
      <CompanyForm
        company={editing === true ? undefined : editing}
        user={user}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          if (companyId) setState({ status: "ready", data: saved });
          else load();
        }}
      />
    );
  if (companyId) {
    const c = state.data;
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Company detail</p>
            <h1>{c.name}</h1>
            <p>
              {c.lifecycleStatus} · Updated{" "}
              {new Date(c.updatedAt).toLocaleString()}
            </p>
          </div>
          {canEdit && (
            <div className="heading-actions">
              <Button variant="quiet" onClick={() => setEditing(c)}>
                Edit
              </Button>
              <Button
                variant={c.archivedAt ? "primary" : "danger"}
                onClick={() => setConfirm(true)}
              >
                {c.archivedAt ? "Restore" : "Archive"}
              </Button>
            </div>
          )}
        </div>
        <section className="panel company-detail">
          <dl>
            <div>
              <dt>Organization number</dt>
              <dd>{c.organizationNumber || "—"}</dd>
            </div>
            <div>
              <dt>External reference</dt>
              <dd>{c.externalReference || "—"}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>{c.website ? <a href={c.website}>{c.website}</a> : "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{c.phone || "—"}</dd>
            </div>
            <div>
              <dt>Industry / size</dt>
              <dd>{[c.industry, c.size].filter(Boolean).join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{c.ownerName || "Unassigned"}</dd>
            </div>
            <div>
              <dt>Tags</dt>
              <dd>{c.tags.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{c.description || "—"}</dd>
            </div>
          </dl>
        </section>
        <section
          className="metrics related-metrics"
          aria-label="Related company records"
        >
          {Object.entries(c.related).map(([key, value]) => (
            <a className="metric" href={`#${key}?company=${c.id}`} key={key}>
              <span>{key}</span>
              <strong>{value}</strong>
              <small>View related →</small>
            </a>
          ))}
        </section>
        <section className="panel">
          <div className="panel__heading">
            <h2>Change history</h2>
          </div>
          {c.history.length ? (
            <ul className="history">
              {c.history.map((item, index) => (
                <li key={index}>
                  <strong>{item.action.replace("company.", "")}</strong>
                  <time>{new Date(item.createdAt).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          ) : (
            <OperationalState type="empty" title="No changes recorded" />
          )}
        </section>
        <Dialog
          open={confirm}
          title={`${c.archivedAt ? "Restore" : "Archive"} ${c.name}?`}
          description={
            c.archivedAt
              ? "The company will return to active lists."
              : "The company will leave active lists while contacts, activities, deals, tasks, and history remain intact."
          }
          confirmLabel={c.archivedAt ? "Restore company" : "Archive company"}
          destructive={!c.archivedAt}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await api(`/${c.id}/${c.archivedAt ? "restore" : "archive"}`, {
              method: "POST",
            });
            setConfirm(false);
            load();
          }}
        />
      </>
    );
  }
  const result = state.data,
    update = (key, value) => {
      const next = new URLSearchParams(filters);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      setFilters(next);
      location.hash = `companies?${next}`;
    };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Accounts</p>
          <h1>Companies</h1>
          <p>{result.total} companies match this view.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing(true)}>+ Add company</Button>
        )}
      </div>
      <section className="panel">
        <div className="filters company-filters">
          <label>
            Search
            <input
              type="search"
              value={filters.get("q") || ""}
              onChange={(e) => update("q", e.target.value)}
              placeholder="Name or reference"
            />
          </label>
          <label>
            Lifecycle
            <select
              value={filters.get("lifecycle") || ""}
              onChange={(e) => update("lifecycle", e.target.value)}
            >
              <option value="">All</option>
              <option>lead</option>
              <option>prospect</option>
              <option>customer</option>
              <option>inactive</option>
            </select>
          </label>
          <label>
            Industry
            <input
              value={filters.get("industry") || ""}
              onChange={(e) => update("industry", e.target.value)}
            />
          </label>
          <label>
            Tag
            <input
              value={filters.get("tag") || ""}
              onChange={(e) => update("tag", e.target.value)}
            />
          </label>
          <label>
            Owner
            <select
              value={filters.get("owner") || ""}
              onChange={(e) => update("owner", e.target.value)}
            >
              <option value="">All</option>
              <option value={user?.membershipId}>Assigned to me</option>
            </select>
          </label>
          <label>
            Sort
            <select
              value={filters.get("sort") || "name"}
              onChange={(e) => update("sort", e.target.value)}
            >
              <option value="name">Name</option>
              <option value="updated_at">Recently updated</option>
              <option value="created_at">Created</option>
              <option value="industry">Industry</option>
              <option value="size">Size</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.get("includeArchived") === "true"}
              onChange={(e) =>
                update("includeArchived", e.target.checked ? "true" : "")
              }
            />{" "}
            Archived
          </label>
          <button
            onClick={() => {
              setFilters(new URLSearchParams());
              location.hash = "companies";
            }}
          >
            Clear filters
          </button>
        </div>
        {result.items.length ? (
          <>
            <DataTable
              caption="Companies"
              columns={columns}
              rows={result.items}
            />
            <nav className="pagination" aria-label="Company pages">
              <Button
                variant="quiet"
                disabled={result.page <= 1}
                onClick={() => update("page", String(result.page - 1))}
              >
                Previous
              </Button>
              <span>
                Page {result.page} of {result.pages}
              </span>
              <Button
                variant="quiet"
                disabled={result.page >= result.pages}
                onClick={() => update("page", String(result.page + 1))}
              >
                Next
              </Button>
            </nav>
          </>
        ) : (
          <OperationalState
            type="empty"
            title="No matching companies"
            message="Clear filters or add a company."
          />
        )}
      </section>
    </>
  );
}
