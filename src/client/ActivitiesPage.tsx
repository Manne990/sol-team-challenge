import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Role } from "../auth/types";
import {
  Button,
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

type Activity = {
  id: string;
  type: string;
  subject: string;
  body: string;
  occurredAt: string;
  creator: { id: string; name: string };
  company: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  followUpTaskId: string | null;
  version: number;
};
type Form = {
  type: string;
  subject: string;
  body: string;
  occurredAt: string;
  companyId: string;
  contactId: string;
  dealId: string;
  participantIds: string;
  followUp: boolean;
  followUpTitle: string;
  followUpDueAt: string;
  followUpAssigneeId: string;
  priority: string;
};
const localNow = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};
const blank = (userId: string): Form => ({
  type: "note",
  subject: "",
  body: "",
  occurredAt: localNow(),
  companyId: "",
  contactId: "",
  dealId: "",
  participantIds: "",
  followUp: false,
  followUpTitle: "",
  followUpDueAt: "",
  followUpAssigneeId: userId,
  priority: "normal",
});
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body?.error?.message ?? "The request failed.");
  return body;
}

export function ActivitiesPage({
  role,
  userId,
}: {
  role: Role;
  userId: string;
}) {
  const initial = new URLSearchParams(location.search);
  const [filters, setFilters] = useState({
    type: initial.get("type") ?? "",
    authorId: initial.get("authorId") ?? "",
    companyId: initial.get("companyId") ?? "",
    contactId: initial.get("contactId") ?? "",
    from: initial.get("from") ?? "",
    page: Number(initial.get("page")) || 1,
  });
  const [data, setData] = useState<{
    items: Activity[];
    total: number;
    page: number;
    totalPages: number;
  }>({ items: [], total: 0, page: 1, totalPages: 0 });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState<
    (Activity & { participants: { id: string; name: string }[] }) | null
  >(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== "" && value !== 1)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  const load = useCallback(async () => {
    setState("loading");
    try {
      setData(await api(`/api/activities?${query}`));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [query]);
  useEffect(() => {
    history.replaceState(null, "", `/activities${query ? `?${query}` : ""}`);
    void load();
  }, [load, query]);
  const setFilter = (key: keyof typeof filters, value: string | number) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1,
    }));
  async function open(id: string) {
    setDetail(await api(`/api/activities/${id}`));
  }
  function edit(activity: Activity) {
    setEditing(activity);
    setDetail(null);
    setError("");
    setForm({
      ...blank(userId),
      type: activity.type,
      subject: activity.subject,
      body: activity.body,
      occurredAt: activity.occurredAt.slice(0, 16),
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError("");
    const body = editing
      ? { subject: form.subject, body: form.body, version: editing.version }
      : {
          type: form.type,
          subject: form.subject,
          body: form.body,
          occurredAt: new Date(form.occurredAt).toISOString(),
          companyId: form.companyId || null,
          contactId: form.contactId || null,
          dealId: form.dealId || null,
          participantIds: form.participantIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          followUp: form.followUp
            ? {
                title: form.followUpTitle,
                dueAt: new Date(form.followUpDueAt).toISOString(),
                assigneeId: form.followUpAssigneeId,
                priority: form.priority,
              }
            : null,
        };
    try {
      const saved = await api(
        editing ? `/api/activities/${editing.id}` : "/api/activities",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      setForm(null);
      setEditing(null);
      setNotice(
        editing
          ? "Activity corrected."
          : saved.followUpTaskId
            ? "Activity and follow-up created."
            : "Activity created.",
      );
      await load();
      await open(saved.id);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save activity.",
      );
    }
  }
  const canEdit = role !== "viewer";
  return (
    <>
      <PageHeader
        eyebrow={`${data.total} timeline entries`}
        title="Activities"
        description="Calls, emails, meetings, notes, status changes, and linked follow-up work."
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing(null);
                setError("");
                setForm(blank(userId));
              }}
            >
              Record activity
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        activeCount={
          [
            filters.type,
            filters.authorId,
            filters.companyId,
            filters.contactId,
            filters.from,
          ].filter(Boolean).length
        }
        onClear={() =>
          setFilters({
            type: "",
            authorId: "",
            companyId: "",
            contactId: "",
            from: "",
            page: 1,
          })
        }
      >
        <Field label="Type">
          <Select
            value={filters.type}
            onChange={(event) => setFilter("type", event.target.value)}
          >
            <option value="">All types</option>
            {["call", "email", "meeting", "note", "status_change"].map(
              (type) => (
                <option key={type} value={type}>
                  {type.replace("_", " ")}
                </option>
              ),
            )}
          </Select>
        </Field>
        <Field label="Author ID">
          <TextInput
            value={filters.authorId}
            onChange={(event) => setFilter("authorId", event.target.value)}
          />
        </Field>
        <Field label="Company ID">
          <TextInput
            value={filters.companyId}
            onChange={(event) => setFilter("companyId", event.target.value)}
          />
        </Field>
        <Field label="Contact ID">
          <TextInput
            value={filters.contactId}
            onChange={(event) => setFilter("contactId", event.target.value)}
          />
        </Field>
        <Field label="From">
          <TextInput
            type="date"
            value={filters.from}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </Field>
      </FilterBar>
      {state === "loading" ? (
        <OperationalState kind="loading" />
      ) : state === "error" ? (
        <OperationalState
          kind="error"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : data.items.length === 0 ? (
        <OperationalState
          kind="empty"
          title="No activities match"
          message="Clear filters or record the first customer interaction."
        />
      ) : (
        <>
          <DataTable
            caption="Activity timeline"
            columns={[
              "Occurred",
              "Type",
              "Subject",
              "Related to",
              "Recorded by",
              "Follow-up",
            ]}
          >
            {data.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <time dateTime={item.occurredAt}>
                    {new Date(item.occurredAt).toLocaleString()}
                  </time>
                </td>
                <td>
                  <StatusBadge tone="info">
                    {item.type.replace("_", " ")}
                  </StatusBadge>
                </td>
                <td>
                  <button
                    className="ns-table-link"
                    onClick={() => void open(item.id)}
                  >
                    {item.subject}
                  </button>
                </td>
                <td>
                  {item.company?.name ??
                    item.contact?.name ??
                    item.deal?.name ??
                    "General"}
                </td>
                <td>{item.creator.name}</td>
                <td>{item.followUpTaskId ? "Linked" : "—"}</td>
              </tr>
            ))}
          </DataTable>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPageChange={(page) => setFilter("page", page)}
          />
        </>
      )}
      <Dialog
        open={Boolean(detail)}
        title={detail?.subject ?? "Activity"}
        description={
          detail
            ? `${detail.type.replace("_", " ")} · ${new Date(detail.occurredAt).toLocaleString()}`
            : undefined
        }
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="ns-activity-detail">
            <p>{detail.body || "No notes recorded."}</p>
            <dl>
              <dt>Recorded by</dt>
              <dd>{detail.creator.name}</dd>
              <dt>Company</dt>
              <dd>{detail.company?.name ?? "—"}</dd>
              <dt>Contact</dt>
              <dd>{detail.contact?.name ?? "—"}</dd>
              <dt>Participants</dt>
              <dd>
                {detail.participants.map((person) => person.name).join(", ") ||
                  "—"}
              </dd>
              <dt>Follow-up</dt>
              <dd>{detail.followUpTaskId ? "Linked task created" : "—"}</dd>
            </dl>
            {canEdit && (role === "owner" || detail.creator.id === userId) && (
              <div className="ns-dialog-actions">
                <Button variant="secondary" onClick={() => edit(detail)}>
                  Correct narrative
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(form)}
        title={editing ? "Correct activity narrative" : "Record activity"}
        description={
          editing
            ? "The creator, occurrence, type, relations, and participants remain immutable."
            : "Times are stored in UTC and displayed in your local timezone."
        }
        onClose={() => {
          setForm(null);
          setEditing(null);
        }}
      >
        {form && (
          <form
            className="ns-activity-form"
            onSubmit={(event) => void save(event)}
          >
            {error && (
              <p role="alert" className="ns-form-error">
                {error}
              </p>
            )}
            <Field label="Type" required>
              <Select
                disabled={Boolean(editing)}
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value })
                }
              >
                {["call", "email", "meeting", "note", "status_change"].map(
                  (type) => (
                    <option key={type} value={type}>
                      {type.replace("_", " ")}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label="Occurred" required>
              <TextInput
                disabled={Boolean(editing)}
                type="datetime-local"
                required
                value={form.occurredAt}
                onChange={(event) =>
                  setForm({ ...form, occurredAt: event.target.value })
                }
              />
            </Field>
            <Field label="Subject" required>
              <TextInput
                required
                maxLength={200}
                value={form.subject}
                onChange={(event) =>
                  setForm({ ...form, subject: event.target.value })
                }
              />
            </Field>
            <Field label="Notes">
              <textarea
                className="ns-input"
                maxLength={10000}
                value={form.body}
                onChange={(event) =>
                  setForm({ ...form, body: event.target.value })
                }
              />
            </Field>
            {!editing && (
              <>
                <Field label="Company ID">
                  <TextInput
                    value={form.companyId}
                    onChange={(event) =>
                      setForm({ ...form, companyId: event.target.value })
                    }
                  />
                </Field>
                <Field label="Contact ID">
                  <TextInput
                    value={form.contactId}
                    onChange={(event) =>
                      setForm({ ...form, contactId: event.target.value })
                    }
                  />
                </Field>
                <Field label="Deal ID">
                  <TextInput
                    value={form.dealId}
                    onChange={(event) =>
                      setForm({ ...form, dealId: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Participant contact IDs"
                  hint="Separate multiple IDs with commas."
                >
                  <TextInput
                    value={form.participantIds}
                    onChange={(event) =>
                      setForm({ ...form, participantIds: event.target.value })
                    }
                  />
                </Field>
                <label className="ns-checkbox">
                  <input
                    type="checkbox"
                    checked={form.followUp}
                    onChange={(event) =>
                      setForm({ ...form, followUp: event.target.checked })
                    }
                  />{" "}
                  Create linked follow-up task
                </label>
                {form.followUp && (
                  <>
                    <Field label="Follow-up title" required>
                      <TextInput
                        required
                        value={form.followUpTitle}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            followUpTitle: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Due" required>
                      <TextInput
                        type="datetime-local"
                        required
                        value={form.followUpDueAt}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            followUpDueAt: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Assignee user ID" required>
                      <TextInput
                        required
                        value={form.followUpAssigneeId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            followUpAssigneeId: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Priority">
                      <Select
                        value={form.priority}
                        onChange={(event) =>
                          setForm({ ...form, priority: event.target.value })
                        }
                      >
                        {["low", "normal", "high", "urgent"].map((priority) => (
                          <option key={priority}>{priority}</option>
                        ))}
                      </Select>
                    </Field>
                  </>
                )}
              </>
            )}
            <div className="ns-dialog-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editing ? "Save correction" : "Record activity"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <ToastRegion>
        {notice && <Toast title={notice} onDismiss={() => setNotice("")} />}
      </ToastRegion>
    </>
  );
}
