import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "./AppShell";
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
  SaveViewButton,
  StatusBadge,
  TextInput,
  Toast,
  ToastRegion,
} from "./ui";
type Task = {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  assigneeName: string;
  dueAt: string;
  priority: string;
  status: string;
  dueState: string;
  companyName: string | null;
  contactName: string | null;
  dealName: string | null;
  version: number;
};
type Page = {
  items: Task[];
  page: number;
  total: number;
  totalPages: number;
  timezone: string;
};
type Member = { id: string; name: string };
export function TasksPage({
  role,
  userId,
}: {
  role: UserRole;
  userId: string;
}) {
  const detailId = location.pathname.match(/^\/tasks\/([^/]+)$/)?.[1],
    params = new URLSearchParams(location.search),
    [view, setView] = useState(params.get("view") ?? "mine"),
    [page, setPage] = useState(Number(params.get("page")) || 1),
    [sort, setSort] = useState(params.get("sort") ?? "due"),
    [direction, setDirection] = useState(params.get("direction") ?? "asc"),
    [data, setData] = useState<Page>({
      items: [],
      page: 1,
      total: 0,
      totalPages: 0,
      timezone: "UTC",
    }),
    [members, setMembers] = useState<Member[]>([]),
    [state, setState] = useState<"loading" | "ready" | "error">("loading"),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Task | null>(null),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const query = new URLSearchParams({
        view,
        page: String(page),
        sort,
        direction,
      });
      history.replaceState(null, "", `/tasks?${query}`);
      const [list, meta] = await Promise.all([
        fetch(`/api/tasks?${query}`),
        fetch("/api/tasks/meta"),
      ]);
      if (!list.ok || !meta.ok) throw new Error();
      setData((await list.json()) as Page);
      setMembers(((await meta.json()) as { members: Member[] }).members);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [view, page, sort, direction]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!detailId) return;
    fetch(`/api/tasks/${detailId}`).then(async (response) => {
      if (response.ok) setSelected((await response.json()) as Task);
      else setMessage("The requested task was not found");
    });
  }, [detailId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          assigneeId: form.get("assigneeId"),
          dueAt: new Date(String(form.get("dueAt"))).toISOString(),
          priority: form.get("priority"),
          status: "open",
          companyId: form.get("companyId") || null,
          contactId: form.get("contactId") || null,
          dealId: form.get("dealId") || null,
        }),
      });
    if (response.ok) {
      setOpen(false);
      setMessage("Task created");
      await load();
    } else
      setMessage(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function action(item: Task, name: "complete" | "reopen") {
    const response = await fetch(`/api/tasks/${item.id}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (response.ok) {
      setMessage(name === "complete" ? "Task completed" : "Task reopened");
      await load();
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={`${data.total} tasks · ${data.timezone}`}
        title="Tasks"
        description="Follow-up commitments use UTC for storage and due-state boundaries; times display in your browser timezone."
        actions={
          <>
            <SaveViewButton
              resource="tasks"
              definition={{ view, sort, direction }}
            />
            {role !== "viewer" && (
              <Button onClick={() => setOpen(true)}>Add task</Button>
            )}
          </>
        }
      />
      <FilterBar
        activeCount={view ? 1 : 0}
        onClear={() => {
          setView("");
          setPage(1);
        }}
      >
        <label className="ns-field">
          <span>Due-state view</span>
          <Select
            value={view}
            onChange={(event) => {
              setView(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All active</option>
            <option value="mine">Assigned to me</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today (UTC)</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
          </Select>
        </label>
        <Field label="Sort by">
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="due">Due date</option>
            <option value="title">Title</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="updated">Updated</option>
          </Select>
        </Field>
        <Field label="Direction">
          <Select
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
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
          title="No tasks in this view"
          message="Choose another due-state view or add a task."
        />
      ) : (
        <>
          <DataTable
            caption="Tasks"
            columns={[
              "Task",
              "Assignee",
              "Due",
              "Priority",
              "Status",
              "Action",
            ]}
          >
            {data.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    className="ns-table-link"
                    onClick={() => setSelected(item)}
                  >
                    {item.title}
                  </button>
                  <br />
                  <small>
                    {[item.companyName, item.contactName, item.dealName]
                      .filter(Boolean)
                      .join(" · ") ||
                      item.description ||
                      "No relation"}
                  </small>
                </td>
                <td>{item.assigneeName}</td>
                <td>
                  <time dateTime={item.dueAt}>
                    {new Date(item.dueAt).toLocaleString()}
                  </time>
                </td>
                <td>
                  <StatusBadge
                    tone={
                      item.priority === "urgent"
                        ? "danger"
                        : item.priority === "high"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {item.priority}
                  </StatusBadge>
                </td>
                <td>
                  <StatusBadge
                    tone={
                      item.dueState === "overdue"
                        ? "danger"
                        : item.dueState === "completed"
                          ? "positive"
                          : "info"
                    }
                  >
                    {item.dueState.replaceAll("_", " ")}
                  </StatusBadge>
                </td>
                <td>
                  {role !== "viewer" && (
                    <Button
                      variant="quiet"
                      onClick={() =>
                        void action(
                          item,
                          item.status === "completed" ? "reopen" : "complete",
                        )
                      }
                    >
                      {item.status === "completed" ? "Reopen" : "Complete"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
      <Dialog
        open={open}
        title="Add task"
        description="Times are converted to UTC when saved."
        onClose={() => setOpen(false)}
      >
        <form onSubmit={create}>
          <Field label="Title" required>
            <TextInput name="title" required maxLength={200} autoFocus />
          </Field>
          <Field label="Description">
            <textarea className="ns-input" name="description" rows={3} />
          </Field>
          <Field label="Assignee" required>
            <Select
              name="assigneeId"
              defaultValue={
                members.some((member) => member.id === userId)
                  ? userId
                  : members[0]?.id
              }
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date and time" required>
            <TextInput name="dueAt" type="datetime-local" required />
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Related company ID">
            <TextInput name="companyId" />
          </Field>
          <Field label="Related contact ID">
            <TextInput name="contactId" />
          </Field>
          <Field label="Related deal ID">
            <TextInput name="dealId" />
          </Field>
          <div className="ns-dialog-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create task</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(selected)}
        title={selected?.title ?? "Task detail"}
        description="Follow-up work and originating CRM relationships."
        onClose={() => setSelected(null)}
      >
        {selected && (
          <dl>
            <dt>Description</dt>
            <dd>{selected.description || "—"}</dd>
            <dt>Assignee</dt>
            <dd>{selected.assigneeName}</dd>
            <dt>Due</dt>
            <dd>{new Date(selected.dueAt).toLocaleString()}</dd>
            <dt>Company</dt>
            <dd>{selected.companyName ?? "—"}</dd>
            <dt>Contact</dt>
            <dd>{selected.contactName ?? "—"}</dd>
            <dt>Deal</dt>
            <dd>{selected.dealName ?? "—"}</dd>
          </dl>
        )}
      </Dialog>
      {message && (
        <ToastRegion>
          <Toast
            tone={message.includes("Choose") ? "error" : "success"}
            title={message}
            onDismiss={() => setMessage("")}
          />
        </ToastRegion>
      )}
    </>
  );
}
