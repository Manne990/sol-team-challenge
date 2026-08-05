import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  DataTable,
  Dialog,
  OperationalState,
  ToastRegion,
} from "./components.jsx";
import { SavedViews } from "./Discovery.jsx";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  companyId: "",
  ownerMembershipId: "",
  status: "active",
  communicationPreference: "email",
  tags: "",
};

async function api(path, options) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || "Northstar could not complete that request.",
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function ContactForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(
    initial
      ? {
          ...emptyForm,
          ...initial,
          companyId: initial.company?.id || "",
          ownerMembershipId: initial.owner?.id || "",
          tags: initial.tags.join(", "),
        }
      : emptyForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const update = (event) =>
    setForm((value) => ({ ...value, [event.target.name]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        companyId: form.companyId || null,
        ownerMembershipId: form.ownerMembershipId || null,
        email: form.email || null,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        version: initial?.version,
      };
      const result = await api(
        initial ? `/api/contacts/${initial.id}` : "/api/contacts",
        { method: initial ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      onSaved(result);
    } catch (failure) {
      setError(failure.message);
      if (failure.status === 409 && failure.body?.contact)
        setForm((value) => ({
          ...value,
          version: failure.body.contact.version,
        }));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog contact-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-form-title"
        tabIndex={-1}
        ref={dialog}
      >
        <h2 id="contact-form-title">
          {initial ? "Edit contact" : "Add contact"}
        </h2>
        <p>
          Required fields are marked. Organization relationships are validated
          when saved.
        </p>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="contact-form">
          <label>
            First name *
            <input
              name="firstName"
              required
              maxLength="80"
              value={form.firstName}
              onChange={update}
            />
          </label>
          <label>
            Last name *
            <input
              name="lastName"
              required
              maxLength="80"
              value={form.lastName}
              onChange={update}
            />
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              maxLength="254"
              value={form.email || ""}
              onChange={update}
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
              maxLength="50"
              value={form.phone || ""}
              onChange={update}
            />
          </label>
          <label>
            Job title
            <input
              name="jobTitle"
              maxLength="120"
              value={form.jobTitle || ""}
              onChange={update}
            />
          </label>
          <label>
            Company ID
            <input
              name="companyId"
              value={form.companyId}
              onChange={update}
              placeholder="Optional company ID"
            />
          </label>
          <label>
            Owner membership ID
            <input
              name="ownerMembershipId"
              value={form.ownerMembershipId}
              onChange={update}
              placeholder="Optional member ID"
            />
          </label>
          <label>
            Status
            <select name="status" value={form.status} onChange={update}>
              <option value="lead">Lead</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Communication
            <select
              name="communicationPreference"
              value={form.communicationPreference}
              onChange={update}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="none">Do not contact</option>
            </select>
          </label>
          <label className="contact-form__wide">
            Tags
            <input
              name="tags"
              value={form.tags}
              onChange={update}
              placeholder="vip, renewal"
            />
            <small>Separate tags with commas.</small>
          </label>
          <div className="dialog__actions contact-form__wide">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save contact"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ContactsPage({ role }) {
  const initialParams = new URLSearchParams(
    window.location.hash.split("?")[1] || "",
  );
  const [filters, setFilters] = useState({
    q: initialParams.get("q") || "",
    status: initialParams.get("status") || "",
    tag: initialParams.get("tag") || "",
    companyId: initialParams.get("companyId") || "",
    ownerId: initialParams.get("ownerId") || "",
    archived: initialParams.get("archived") || "",
    sort: initialParams.get("sort") || "name",
    direction: initialParams.get("direction") || "asc",
    page: Number(initialParams.get("page")) || 1,
  });
  const [state, setState] = useState({
    status: "loading",
    contacts: [],
    pagination: {},
  });
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [toasts, setToasts] = useState([]);
  const canEdit = role === "owner" || role === "member";
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== "" && value !== 1)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  const load = async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const result = await api(`/api/contacts?${query}`);
      setState({ status: "ready", ...result });
    } catch (error) {
      setState({
        status: error.status === 403 ? "forbidden" : "error",
        contacts: [],
        pagination: {},
      });
    }
  };
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `#contacts${query ? `?${query}` : ""}`,
    );
    load();
  }, [query]);
  async function openDetail(id) {
    try {
      setDetail({ status: "loading" });
      setDetail({ status: "ready", ...(await api(`/api/contacts/${id}`)) });
    } catch (error) {
      setDetail({ status: error.status === 404 ? "not-found" : "error" });
    }
  }
  const setFilter = (key, value) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? value : 1,
    }));
  async function archive() {
    const result = await api(
      `/api/contacts/${detail.contact.id}${detail.contact.archivedAt ? "/restore" : ""}`,
      { method: detail.contact.archivedAt ? "POST" : "DELETE" },
    );
    setConfirmArchive(false);
    setDetail({ ...detail, contact: result.contact });
    setToasts([
      {
        id: Date.now(),
        message: result.contact.archivedAt
          ? "Contact archived."
          : "Contact restored.",
      },
    ]);
    load();
  }
  const columns = [
    {
      key: "name",
      label: "Contact",
      render: (contact) => (
        <button className="table-link" onClick={() => openDetail(contact.id)}>
          {contact.name}
        </button>
      ),
    },
    {
      key: "company",
      label: "Company",
      render: (contact) => contact.company?.name || "Independent",
    },
    {
      key: "email",
      label: "Email",
      render: (contact) =>
        contact.email ? (
          <a href={`mailto:${contact.email}`}>{contact.email}</a>
        ) : (
          "—"
        ),
    },
    {
      key: "owner",
      label: "Owner",
      render: (contact) => contact.owner?.name || "Unassigned",
    },
    { key: "status", label: "Status" },
    {
      key: "tags",
      label: "Tags",
      render: (contact) => contact.tags.join(", ") || "—",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Relationships</p>
          <h1>Contacts</h1>
          <p>People across customer accounts and independent relationships.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setForm("create")}>+ Add contact</Button>
        )}
      </div>
      <SavedViews
        resource="contacts"
        definition={filters}
        onApply={(value) =>
          setFilters({
            q: "",
            status: "",
            tag: "",
            companyId: "",
            ownerId: "",
            archived: "",
            sort: "name",
            direction: "asc",
            page: 1,
            ...value,
          })
        }
      />
      <section className="panel">
        <div className="filters contact-filters">
          <label>
            Search
            <input
              type="search"
              value={filters.q}
              onChange={(event) => setFilter("q", event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) => setFilter("status", event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="lead">Lead</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Tag
            <input
              value={filters.tag}
              onChange={(event) => setFilter("tag", event.target.value)}
            />
          </label>
          <label>
            Company ID
            <input
              value={filters.companyId}
              onChange={(event) => setFilter("companyId", event.target.value)}
              placeholder="Any company"
            />
          </label>
          <label>
            Owner ID
            <input
              value={filters.ownerId}
              onChange={(event) => setFilter("ownerId", event.target.value)}
              placeholder="Any owner"
            />
          </label>
          <label>
            Records
            <select
              value={filters.archived}
              onChange={(event) => setFilter("archived", event.target.value)}
            >
              <option value="">Active contacts</option>
              <option value="true">Include archived</option>
            </select>
          </label>
          <label>
            Sort
            <select
              value={`${filters.sort}:${filters.direction}`}
              onChange={(event) => {
                const [sort, direction] = event.target.value.split(":");
                setFilters((current) => ({
                  ...current,
                  sort,
                  direction,
                  page: 1,
                }));
              }}
            >
              <option value="name:asc">Name A–Z</option>
              <option value="name:desc">Name Z–A</option>
              <option value="updatedAt:desc">Recently updated</option>
              <option value="email:asc">Email</option>
            </select>
          </label>
          <button
            onClick={() =>
              setFilters({
                q: "",
                status: "",
                tag: "",
                companyId: "",
                ownerId: "",
                archived: "",
                sort: "name",
                direction: "asc",
                page: 1,
              })
            }
          >
            Clear filters
          </button>
        </div>
        {state.status === "loading" ? (
          <OperationalState type="loading" title="Loading contacts" />
        ) : state.status !== "ready" ? (
          <OperationalState
            type={state.status}
            action={
              <Button variant="quiet" onClick={load}>
                Try again
              </Button>
            }
          />
        ) : state.contacts.length === 0 ? (
          <OperationalState
            type="empty"
            title="No matching contacts"
            message="Clear filters or add a contact to this organization."
          />
        ) : (
          <>
            <DataTable
              caption="Contacts"
              columns={columns}
              rows={state.contacts}
            />
            <div className="pagination">
              <span>
                Page {state.pagination.page} of {state.pagination.pages} ·{" "}
                {state.pagination.total} contacts
              </span>
              <Button
                variant="quiet"
                disabled={state.pagination.page <= 1}
                onClick={() => setFilter("page", filters.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="quiet"
                disabled={state.pagination.page >= state.pagination.pages}
                onClick={() => setFilter("page", filters.page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
      {detail && (
        <div
          className="detail-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDetail(null)
          }
        >
          <aside className="contact-detail" aria-label="Contact details">
            <button
              className="detail-close"
              aria-label="Close contact details"
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            {detail.status !== "ready" ? (
              <OperationalState type={detail.status} />
            ) : (
              <>
                <p className="eyebrow">{detail.contact.status}</p>
                <h2>{detail.contact.name}</h2>
                <p>
                  {detail.contact.jobTitle || "No job title"}
                  {detail.contact.company
                    ? ` · ${detail.contact.company.name}`
                    : " · Independent contact"}
                </p>
                {detail.warnings?.map((warning) => (
                  <div
                    className="duplicate-warning"
                    role="status"
                    key={warning.contactId}
                  >
                    <strong>Possible duplicate</strong>
                    <span>{warning.message} Records were not merged.</span>
                  </div>
                ))}
                <dl className="contact-facts">
                  <div>
                    <dt>Email</dt>
                    <dd>{detail.contact.email || "—"}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{detail.contact.phone || "—"}</dd>
                  </div>
                  <div>
                    <dt>Preference</dt>
                    <dd>{detail.contact.communicationPreference}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{detail.contact.owner?.name || "Unassigned"}</dd>
                  </div>
                </dl>
                {canEdit && (
                  <div className="detail-actions">
                    <Button onClick={() => setForm("edit")}>Edit</Button>
                    <Button
                      variant="quiet"
                      onClick={() => setConfirmArchive(true)}
                    >
                      {detail.contact.archivedAt ? "Restore" : "Archive"}
                    </Button>
                  </div>
                )}
                {[
                  [
                    "Activities",
                    detail.activities,
                    (item) =>
                      `${item.subject} · ${new Date(item.occurredAt).toLocaleString()}`,
                  ],
                  [
                    "Deals",
                    detail.deals,
                    (item) => `${item.name} · ${item.stage}`,
                  ],
                  [
                    "Tasks",
                    detail.tasks,
                    (item) => `${item.title} · ${item.status}`,
                  ],
                  [
                    "Change history",
                    detail.history,
                    (item) =>
                      `${item.action.replaceAll(".", " ")} · ${new Date(item.createdAt).toLocaleString()}`,
                  ],
                ].map(([title, items, render]) => (
                  <section className="detail-section" key={title}>
                    <h3>{title}</h3>
                    {items.length ? (
                      <ul>
                        {items.map((item) => (
                          <li key={item.id}>{render(item)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No {title.toLowerCase()} yet.</p>
                    )}
                  </section>
                ))}
              </>
            )}
          </aside>
        </div>
      )}
      {form && (
        <ContactForm
          initial={form === "edit" ? detail.contact : null}
          onClose={() => setForm(null)}
          onSaved={(result) => {
            setForm(null);
            setToasts([
              {
                id: Date.now(),
                message: result.warnings?.length
                  ? `Contact saved. ${result.warnings.length} possible duplicate found.`
                  : "Contact saved.",
              },
            ]);
            load();
            openDetail(result.contact.id);
          }}
        />
      )}
      <Dialog
        open={confirmArchive}
        title={
          detail?.contact?.archivedAt ? "Restore contact?" : "Archive contact?"
        }
        description={
          detail?.contact?.archivedAt
            ? "The contact will return to active lists with all history intact."
            : "The contact leaves active lists, but activities, deals, tasks, and history remain available."
        }
        confirmLabel={
          detail?.contact?.archivedAt ? "Restore contact" : "Archive contact"
        }
        destructive={!detail?.contact?.archivedAt}
        onClose={() => setConfirmArchive(false)}
        onConfirm={archive}
      />
      <ToastRegion messages={toasts} onDismiss={() => setToasts([])} />
    </>
  );
}
