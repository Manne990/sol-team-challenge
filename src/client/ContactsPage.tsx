import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Role } from "../shared/auth";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  FilterBar,
  OperationalState,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  TextInput,
  Toast,
  ToastRegion,
} from "./components/ui";

type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  status: string;
  tags: string[];
  communicationPreference: string;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  archivedAt: string | null;
  version: number;
};
type Detail = {
  contact: Contact;
  activities: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  history: { id: string; action: string; createdAt: string }[];
  warnings: { message: string }[];
};
type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyId: string;
  ownerMembershipId: string;
  status: string;
  communicationPreference: string;
  tags: string;
};
const emptyForm: FormState = {
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

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(body?.error?.message ?? "The request failed."),
      { status: response.status, body },
    );
  return body;
}

export function ContactsPage({ role }: { role: Role }) {
  const initial = new URLSearchParams(location.search);
  const [filters, setFilters] = useState({
    q: initial.get("q") ?? "",
    status: initial.get("status") ?? "",
    tag: initial.get("tag") ?? "",
    page: Number(initial.get("page")) || 1,
  });
  const [list, setList] = useState<{
    status: string;
    contacts: Contact[];
    page: number;
    pages: number;
    total: number;
  }>({ status: "loading", contacts: [], page: 1, pages: 1, total: 0 });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const canEdit = role !== "viewer";
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== "" && value !== 1)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  const load = useCallback(async () => {
    setList((value) => ({ ...value, status: "loading" }));
    try {
      const result = await api(`/api/contacts?${query}`);
      setList({
        status: "ready",
        contacts: result.contacts,
        page: result.pagination.page,
        pages: result.pagination.pages,
        total: result.pagination.total,
      });
    } catch {
      setList({ status: "error", contacts: [], page: 1, pages: 1, total: 0 });
    }
  }, [query]);
  useEffect(() => {
    history.replaceState(null, "", `/contacts${query ? `?${query}` : ""}`);
    void load();
  }, [load, query]);
  const setFilter = (key: keyof typeof filters, value: string | number) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1,
    }));
  async function openContact(id: string) {
    setDetail(await api(`/api/contacts/${id}`));
  }
  function openForm(contact?: Contact) {
    setEditing(contact ?? null);
    setError("");
    setForm(
      contact
        ? {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            jobTitle: contact.jobTitle ?? "",
            companyId: contact.company?.id ?? "",
            ownerMembershipId: contact.owner?.id ?? "",
            status: contact.status,
            communicationPreference: contact.communicationPreference,
            tags: contact.tags.join(", "),
          }
        : emptyForm,
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError("");
    const payload = {
      ...form,
      email: form.email || null,
      phone: form.phone || null,
      jobTitle: form.jobTitle || null,
      companyId: form.companyId || null,
      ownerMembershipId: form.ownerMembershipId || null,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      version: editing?.version,
    };
    try {
      const result = await api(
        editing ? `/api/contacts/${editing.id}` : "/api/contacts",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      setForm(null);
      setNotice(result.warnings?.[0]?.message ?? "Contact saved.");
      await load();
      await openContact(result.contact.id);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save contact.",
      );
    }
  }
  async function archiveOrRestore() {
    if (!detail) return;
    const restoring = Boolean(detail.contact.archivedAt);
    const result = await api(
      `/api/contacts/${detail.contact.id}${restoring ? "/restore" : ""}`,
      { method: restoring ? "POST" : "DELETE" },
    );
    setConfirm(false);
    setDetail({ ...detail, contact: result.contact });
    setNotice(restoring ? "Contact restored." : "Contact archived.");
    await load();
  }
  return (
    <>
      <PageHeader
        eyebrow="Relationships"
        title="Contacts"
        description="People across customer accounts and independent relationships."
        actions={
          canEdit ? (
            <Button onClick={() => openForm()}>Add contact</Button>
          ) : undefined
        }
      />
      <FilterBar
        activeCount={
          [filters.q, filters.status, filters.tag].filter(Boolean).length
        }
        onClear={() => setFilters({ q: "", status: "", tag: "", page: 1 })}
      >
        <Field label="Search">
          <TextInput
            type="search"
            value={filters.q}
            onChange={(event) => setFilter("q", event.target.value)}
          />
        </Field>
        <Field label="Status">
          <Select
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="lead">Lead</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <Field label="Tag">
          <TextInput
            value={filters.tag}
            onChange={(event) => setFilter("tag", event.target.value)}
          />
        </Field>
      </FilterBar>
      {list.status === "loading" ? (
        <OperationalState kind="loading" />
      ) : list.status === "error" ? (
        <OperationalState
          kind="error"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : list.contacts.length === 0 ? (
        <OperationalState
          kind="empty"
          title="No contacts match"
          message="Clear filters or add a contact."
        />
      ) : (
        <>
          <p className="ns-record-count">{list.total} contacts</p>
          <DataTable
            caption="Contacts"
            columns={["Contact", "Company", "Email", "Owner", "Status", "Tags"]}
          >
            {list.contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <button
                    className="ns-table-link"
                    onClick={() => void openContact(contact.id)}
                  >
                    {contact.name}
                  </button>
                </td>
                <td>{contact.company?.name ?? "Independent"}</td>
                <td>
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{contact.owner?.name ?? "Unassigned"}</td>
                <td>
                  <StatusBadge
                    tone={contact.status === "active" ? "positive" : "neutral"}
                  >
                    {contact.status}
                  </StatusBadge>
                </td>
                <td>{contact.tags.join(", ") || "—"}</td>
              </tr>
            ))}
          </DataTable>
          <Pagination
            page={list.page}
            totalPages={list.pages}
            onPageChange={(page) => setFilter("page", page)}
          />
        </>
      )}
      <Dialog
        open={Boolean(detail)}
        title={detail?.contact.name ?? "Contact"}
        description={detail?.contact.jobTitle ?? undefined}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="ns-contact-detail">
            <dl>
              <dt>Email</dt>
              <dd>{detail.contact.email ?? "—"}</dd>
              <dt>Phone</dt>
              <dd>{detail.contact.phone ?? "—"}</dd>
              <dt>Company</dt>
              <dd>{detail.contact.company?.name ?? "Independent"}</dd>
              <dt>Communication</dt>
              <dd>{detail.contact.communicationPreference}</dd>
            </dl>
            {detail.warnings.map((warning) => (
              <p className="ns-warning" key={warning.message}>
                {warning.message}
              </p>
            ))}
            <h3>Shared history</h3>
            <p>
              {detail.activities.length} activities · {detail.deals.length}{" "}
              deals · {detail.tasks.length} tasks
            </p>
            <ul>
              {detail.history.map((item) => (
                <li key={item.id}>
                  {item.action}{" "}
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="ns-dialog-actions">
                <Button
                  variant="secondary"
                  onClick={() => openForm(detail.contact)}
                >
                  Edit
                </Button>
                <Button
                  variant={detail.contact.archivedAt ? "secondary" : "danger"}
                  onClick={() => setConfirm(true)}
                >
                  {detail.contact.archivedAt ? "Restore" : "Archive"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(form)}
        title={editing ? "Edit contact" : "Add contact"}
        description="Required fields are marked."
        onClose={() => setForm(null)}
      >
        {form && (
          <form
            className="ns-contact-form"
            onSubmit={(event) => void save(event)}
          >
            {error && (
              <p role="alert" className="ns-form-error">
                {error}
              </p>
            )}
            {(
              [
                "firstName",
                "lastName",
                "email",
                "phone",
                "jobTitle",
                "companyId",
                "ownerMembershipId",
                "tags",
              ] as const
            ).map((name) => (
              <Field
                key={name}
                label={
                  {
                    firstName: "First name",
                    lastName: "Last name",
                    email: "Email",
                    phone: "Phone",
                    jobTitle: "Job title",
                    companyId: "Company ID",
                    ownerMembershipId: "Owner membership ID",
                    tags: "Tags",
                  }[name]
                }
                required={name === "firstName" || name === "lastName"}
              >
                <TextInput
                  name={name}
                  type={name === "email" ? "email" : "text"}
                  required={name === "firstName" || name === "lastName"}
                  value={form[name]}
                  onChange={(event) =>
                    setForm({ ...form, [name]: event.target.value })
                  }
                />
              </Field>
            ))}
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value })
                }
              >
                <option value="lead">Lead</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
            <Field label="Communication">
              <Select
                value={form.communicationPreference}
                onChange={(event) =>
                  setForm({
                    ...form,
                    communicationPreference: event.target.value,
                  })
                }
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="none">Do not contact</option>
              </Select>
            </Field>
            <div className="ns-dialog-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save contact</Button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirm}
        title={
          detail?.contact.archivedAt ? "Restore contact?" : "Archive contact?"
        }
        consequences="The contact leaves active lists, while activities, deals, tasks, and history remain available."
        confirmLabel={
          detail?.contact.archivedAt ? "Restore contact" : "Archive contact"
        }
        danger={!detail?.contact.archivedAt}
        onClose={() => setConfirm(false)}
        onConfirm={() => void archiveOrRestore()}
      />
      <ToastRegion>
        {notice && <Toast title={notice} onDismiss={() => setNotice("")} />}
      </ToastRegion>
    </>
  );
}
