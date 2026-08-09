import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  DataTable,
  OperationalState,
  ToastRegion,
} from "./components.jsx";
import { SavedViews } from "./Discovery.jsx";

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
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}
const initialForm = {
  title: "",
  description: "",
  assigneeMembershipId: "",
  dueAt: "",
  priority: "normal",
  companyId: "",
  contactId: "",
  dealId: "",
};
const localValue = (utc) =>
  utc ? new Date(utc).toISOString().slice(0, 16) : "";

function TaskForm({ task, members, onClose, onSaved }) {
  const [form, setForm] = useState(
    task
      ? {
          ...initialForm,
          ...task,
          assigneeMembershipId: task.assignee.id,
          dueAt: localValue(task.dueAt),
          companyId: task.company?.id || "",
          contactId: task.contact?.id || "",
          dealId: task.deal?.id || "",
        }
      : { ...initialForm, assigneeMembershipId: members[0]?.id || "" },
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
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        version: task?.version,
        dueAt: form.dueAt ? new Date(`${form.dueAt}:00Z`).toISOString() : null,
        companyId: form.companyId || null,
        contactId: form.contactId || null,
        dealId: form.dealId || null,
      };
      const result = await api(task ? `/api/tasks/${task.id}` : "/api/tasks", {
        method: task ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved(result.task);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-form-title"
        tabIndex={-1}
        ref={dialog}
      >
        <h2 id="task-form-title">{task ? "Edit task" : "Add task"}</h2>
        <p>Due times are entered and displayed in UTC.</p>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <form className="contact-form" onSubmit={submit}>
          <label className="contact-form__wide">
            Title *
            <input
              name="title"
              required
              maxLength="160"
              value={form.title}
              onChange={update}
            />
          </label>
          <label>
            Assignee *
            <select
              name="assigneeMembershipId"
              required
              value={form.assigneeMembershipId}
              onChange={update}
            >
              <option value="">Choose member</option>
              {members.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
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
          <label>
            Due at (UTC)
            <input
              type="datetime-local"
              name="dueAt"
              value={form.dueAt}
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
          <label className="contact-form__wide">
            Description
            <textarea
              name="description"
              maxLength="5000"
              rows="4"
              value={form.description}
              onChange={update}
            />
          </label>
          <div className="dialog__actions contact-form__wide">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save task"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TasksPage({ role }) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const [filters, setFilters] = useState({
    view: params.get("view") || "open",
    assignedToMe: params.get("assignedToMe") || "",
    q: params.get("q") || "",
    priority: params.get("priority") || "",
    page: Number(params.get("page")) || 1,
  });
  const [state, setState] = useState({
    status: "loading",
    items: [],
    page: 1,
    pages: 1,
    total: 0,
  });
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState([]);
  const canEdit = role === "owner" || role === "member";
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== "" && value !== 1)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  const load = async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      setState({ status: "ready", ...(await api(`/api/tasks?${query}`)) });
    } catch (error) {
      setState({
        status: error.status === 403 ? "forbidden" : "error",
        items: [],
        page: 1,
        pages: 1,
        total: 0,
      });
    }
  };
  useEffect(() => {
    history.replaceState(null, "", `#tasks${query ? `?${query}` : ""}`);
    load();
  }, [query]);
  useEffect(() => {
    if (canEdit)
      api("/api/tasks/assignees")
        .then((body) => setMembers(body.items))
        .catch(() => {});
  }, [canEdit]);
  const setFilter = (key, value) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? value : 1,
    }));
  async function transition(task, action) {
    try {
      const result = await api(`/api/tasks/${task.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ version: task.version }),
      });
      setToast([
        {
          id: Date.now(),
          message: `Task ${action === "complete" ? "completed" : action === "reopen" ? "reopened" : action === "archive" ? "archived" : "restored"}.`,
        },
      ]);
      await load();
      return result.task;
    } catch (error) {
      setToast([
        {
          id: Date.now(),
          message:
            error.code === "EDIT_CONFLICT"
              ? "Task changed. Refresh and try again."
              : error.message,
        },
      ]);
    }
  }
  const columns = [
    {
      key: "title",
      label: "Task",
      render: (task) => (
        <button
          className="table-link"
          onClick={() => setForm(task)}
          disabled={!canEdit}
        >
          {task.title}
        </button>
      ),
    },
    {
      key: "assignee",
      label: "Assignee",
      render: (task) => task.assignee.name,
    },
    {
      key: "dueAt",
      label: "Due (UTC)",
      render: (task) =>
        task.dueAt
          ? new Date(task.dueAt).toISOString().replace("T", " ").slice(0, 16)
          : "No due date",
    },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    {
      key: "related",
      label: "Related",
      render: (task) =>
        task.company?.name || task.contact?.name || task.deal?.name || "—",
    },
    {
      key: "actions",
      label: "Actions",
      render: (task) =>
        canEdit ? (
          <div className="task-actions">
            {!task.archivedAt && task.status === "open" && (
              <Button
                variant="quiet"
                onClick={() => transition(task, "complete")}
              >
                Complete
              </Button>
            )}
            {!task.archivedAt && task.status === "completed" && (
              <Button
                variant="quiet"
                onClick={() => transition(task, "reopen")}
              >
                Reopen
              </Button>
            )}
            {!task.archivedAt && (
              <Button
                variant="quiet"
                onClick={() => transition(task, "archive")}
              >
                Archive
              </Button>
            )}
            {task.archivedAt && (
              <Button
                variant="quiet"
                onClick={() => transition(task, "restore")}
              >
                Restore
              </Button>
            )}
          </div>
        ) : (
          "Read only"
        ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Follow-up work</p>
          <h1>Tasks</h1>
          <p>
            Operational commitments and due times shown consistently in UTC.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setForm("create")}>+ Add task</Button>
        )}
      </div>
      <SavedViews
        resource="tasks"
        definition={filters}
        onApply={(value) =>
          setFilters({
            view: "open",
            assignedToMe: "",
            q: "",
            priority: "",
            page: 1,
            ...value,
          })
        }
      />
      <nav className="task-views" aria-label="Task views">
        {[
          ["open", "Open"],
          ["overdue", "Overdue"],
          ["today", "Due today"],
          ["upcoming", "Upcoming"],
          ["completed", "Completed"],
          ["archived", "Archived"],
        ].map(([value, label]) => (
          <button
            className={filters.view === value ? "active" : ""}
            onClick={() => setFilter("view", value)}
            aria-current={filters.view === value ? "page" : undefined}
            key={value}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="panel">
        <div className="filters task-filters">
          <label>
            Search
            <input
              type="search"
              value={filters.q}
              onChange={(event) => setFilter("q", event.target.value)}
            />
          </label>
          <label>
            Priority
            <select
              value={filters.priority}
              onChange={(event) => setFilter("priority", event.target.value)}
            >
              <option value="">All</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.assignedToMe === "true"}
              onChange={(event) =>
                setFilter("assignedToMe", event.target.checked ? "true" : "")
              }
            />{" "}
            Assigned to me
          </label>
          <button
            onClick={() =>
              setFilters({
                view: "open",
                assignedToMe: "",
                q: "",
                priority: "",
                page: 1,
              })
            }
          >
            Clear filters
          </button>
        </div>
        {state.status === "loading" ? (
          <OperationalState type="loading" />
        ) : state.status === "error" ? (
          <OperationalState
            type="error"
            action={<Button onClick={load}>Try again</Button>}
          />
        ) : state.status === "forbidden" ? (
          <OperationalState type="forbidden" />
        ) : state.items.length === 0 ? (
          <OperationalState type="empty" />
        ) : (
          <DataTable
            caption={`${filters.view} tasks`}
            columns={columns}
            rows={state.items}
          />
        )}
        <div className="pagination">
          <Button
            variant="quiet"
            disabled={state.page <= 1}
            onClick={() => setFilter("page", state.page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {state.page} of {state.pages} · {state.total} tasks
          </span>
          <Button
            variant="quiet"
            disabled={state.page >= state.pages}
            onClick={() => setFilter("page", state.page + 1)}
          >
            Next
          </Button>
        </div>
      </section>
      {form && (
        <TaskForm
          task={form === "create" ? null : form}
          members={members}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setToast([{ id: Date.now(), message: "Task saved." }]);
            load();
          }}
        />
      )}
      <ToastRegion messages={toast} onDismiss={() => setToast([])} />
    </>
  );
}
