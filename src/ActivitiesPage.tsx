/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type FormEvent } from "react";
import { Button, OperationalState } from "./client/components";

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/activities${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body?.error?.message || "Could not load activity history.");
  return body;
}

const blank = (user: any) => ({
  type: "call",
  subject: "",
  body: "",
  occurredAt: new Date().toISOString().slice(0, 16),
  companyId: "",
  contactId: "",
  dealId: "",
  participantIds: "",
  addFollowUp: false,
  followUpTitle: "",
  assigneeMembershipId: user.membershipId,
  dueAt: "",
  priority: "normal",
});

function ActivityForm({ user, onClose, onSaved }: any) {
  const [form, setForm] = useState(() => blank(user));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = ({ target }: any) =>
    setForm((value) => ({
      ...value,
      [target.name]: target.type === "checkbox" ? target.checked : target.value,
    }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("", {
        method: "POST",
        body: JSON.stringify({
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
          followUp: form.addFollowUp
            ? {
                title: form.followUpTitle,
                assigneeMembershipId: form.assigneeMembershipId,
                dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
                priority: form.priority,
              }
            : null,
        }),
      });
      onSaved(result.activity);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save activity.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel activity-form">
      <div className="panel__heading">
        <div>
          <h2>Record activity</h2>
          <p>
            Times are stored in UTC. Related IDs must belong to this workspace.
          </p>
        </div>
      </div>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        <div className="activity-form__grid">
          <label>
            Type
            <select name="type" value={form.type} onChange={update}>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
              <option value="status_change">Status change</option>
            </select>
          </label>
          <label>
            Occurred time *
            <input
              name="occurredAt"
              type="datetime-local"
              required
              value={form.occurredAt}
              onChange={update}
            />
          </label>
          <label className="wide">
            Subject *
            <input
              name="subject"
              required
              maxLength={200}
              value={form.subject}
              onChange={update}
            />
          </label>
          <label className="wide">
            Summary
            <textarea
              name="body"
              maxLength={10000}
              value={form.body}
              onChange={update}
            />
          </label>
          <label>
            Company ID
            <input name="companyId" value={form.companyId} onChange={update} />
          </label>
          <label>
            Contact ID
            <input name="contactId" value={form.contactId} onChange={update} />
          </label>
          <label>
            Deal ID
            <input name="dealId" value={form.dealId} onChange={update} />
          </label>
          <label>
            Participant contact IDs
            <input
              name="participantIds"
              value={form.participantIds}
              onChange={update}
              placeholder="Comma separated"
            />
          </label>
          <label className="wide follow-up-check">
            <input
              name="addFollowUp"
              type="checkbox"
              checked={form.addFollowUp}
              onChange={update}
            />{" "}
            Create linked follow-up task
          </label>
          {form.addFollowUp && (
            <>
              <label>
                Follow-up title *
                <input
                  name="followUpTitle"
                  required
                  value={form.followUpTitle}
                  onChange={update}
                />
              </label>
              <label>
                Assignee membership ID *
                <input
                  name="assigneeMembershipId"
                  required
                  value={form.assigneeMembershipId}
                  onChange={update}
                />
              </label>
              <label>
                Due time
                <input
                  name="dueAt"
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={update}
                />
              </label>
              <label>
                Priority
                <select name="priority" value={form.priority} onChange={update}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Record activity"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ActivitiesPage({ role, user, companyId = "" }: any) {
  const [state, setState] = useState<any>({ status: "loading" });
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const load = () => {
    setState({ status: "loading" });
    const query = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (type) query.set("type", type);
    if (companyId) query.set("companyId", companyId);
    api(`?${query}`)
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => setState({ status: "error", error }));
  };
  useEffect(load, [type, page]);
  if (creating)
    return (
      <ActivityForm
        user={user}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          load();
        }}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Shared history</p>
          <h1>Activities</h1>
          <p>
            {companyId
              ? `Filtered for company ${companyId}.`
              : "Calls, emails, meetings, notes, and status changes in chronological order."}
          </p>
        </div>
        {role !== "viewer" && (
          <Button onClick={() => setCreating(true)}>Record activity</Button>
        )}
      </div>
      <section className="panel">
        <div className="filters">
          <label>
            Type{" "}
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              <option value="call">Calls</option>
              <option value="email">Emails</option>
              <option value="meeting">Meetings</option>
              <option value="note">Notes</option>
              <option value="status_change">Status changes</option>
            </select>
          </label>
          {type && <button onClick={() => setType("")}>Clear filters</button>}
        </div>
        {state.status === "loading" ? (
          <OperationalState kind="loading" />
        ) : state.status === "error" ? (
          <OperationalState
            kind="error"
            message={state.error.message}
            action={
              <Button variant="quiet" onClick={load}>
                Try again
              </Button>
            }
          />
        ) : state.data.activities.length === 0 ? (
          <OperationalState
            kind="empty"
            title="No activities found"
            message="Change the filter or record the first interaction."
          />
        ) : (
          <>
            <ol className="activity-timeline">
              {state.data.activities.map((activity: any) => (
                <li key={activity.id}>
                  <span aria-hidden="true" />
                  <article>
                    <div>
                      <strong>{activity.subject}</strong>
                      <time dateTime={activity.occurredAt}>
                        {new Date(activity.occurredAt).toLocaleString()}
                      </time>
                    </div>
                    <p>{activity.body || "No summary recorded."}</p>
                    <small>
                      {activity.type.replace("_", " ")} ·{" "}
                      {activity.creator.name}
                      {Object.values(activity.relatedLabels).length
                        ? ` · ${Object.values(activity.relatedLabels).join(" · ")}`
                        : ""}
                    </small>
                    {activity.followUpTaskId && (
                      <p>
                        <a href={`#tasks/${activity.followUpTaskId}`}>
                          Open linked follow-up →
                        </a>
                      </p>
                    )}
                  </article>
                </li>
              ))}
            </ol>
            <div className="pagination">
              <Button
                variant="quiet"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {state.data.pagination.page} of{" "}
                {state.data.pagination.pages}
              </span>
              <Button
                variant="quiet"
                disabled={page >= state.data.pagination.pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
