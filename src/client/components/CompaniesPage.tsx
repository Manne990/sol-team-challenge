import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "./AppShell";
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
} from "./ui";

type Company = {
  id: string;
  name: string;
  organizationNumber: string | null;
  externalReference: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  size: string | null;
  address: string | null;
  lifecycleStatus: string;
  ownerId: string | null;
  ownerName: string | null;
  tags: string[];
  description: string;
  archivedAt: string | null;
  updatedAt: string;
  version: number;
};
type CompanyDetail = Company & {
  related: Record<"contacts" | "activities" | "deals" | "tasks", number>;
  history: { action: string; occurredAt: string }[];
  activities: {
    id: string;
    type: string;
    subject: string;
    occurredAt: string;
    creatorLabel: string;
  }[];
};
type Page = {
  items: Company[];
  page: number;
  total: number;
  totalPages: number;
};
const empty: Page = { items: [], page: 1, total: 0, totalPages: 0 };
export function CompaniesPage({ role }: { role: UserRole }) {
  const detailId = location.pathname.match(/^\/companies\/([^/]+)$/)?.[1];
  if (detailId) return <CompanyDetailPage id={detailId} role={role} />;
  return <CompanyList role={role} />;
}

function CompanyList({ role }: { role: UserRole }) {
  const initial = new URLSearchParams(location.search);
  const [query, setQuery] = useState(initial.get("q") ?? "");
  const [lifecycle, setLifecycle] = useState(initial.get("lifecycle") ?? "");
  const [page, setPage] = useState(Number(initial.get("page")) || 1);
  const [data, setData] = useState(empty);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    const params = new URLSearchParams({
      page: String(page),
      sort: "updated",
      direction: "desc",
    });
    if (query) params.set("q", query);
    if (lifecycle) params.set("lifecycle", lifecycle);
    history.replaceState(null, "", `/companies?${params}`);
    try {
      const response = await fetch(`/api/companies?${params}`);
      if (!response.ok) throw new Error();
      setData((await response.json()) as Page);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [query, lifecycle, page]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        organizationNumber: form.get("organizationNumber"),
        externalReference: form.get("externalReference"),
        website: form.get("website"),
        phone: form.get("phone"),
        industry: form.get("industry"),
        size: form.get("size"),
        address: form.get("address"),
        lifecycleStatus: form.get("lifecycleStatus"),
        tags: String(form.get("tags") ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        description: form.get("description"),
      }),
    });
    if (response.ok) {
      setDialog(false);
      setToast("Company created");
      await load();
    } else {
      const body = (await response.json()) as { error: { message: string } };
      setToast(body.error.message);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={`${data.total} records`}
        title="Companies"
        description="Customer and prospect accounts, ownership, and relationship history."
        actions={
          role !== "viewer" ? (
            <Button onClick={() => setDialog(true)}>Add company</Button>
          ) : undefined
        }
      />
      <FilterBar
        activeCount={Number(Boolean(query)) + Number(Boolean(lifecycle))}
        onClear={() => {
          setQuery("");
          setLifecycle("");
          setPage(1);
        }}
      >
        <label className="ns-field">
          <span>Search companies</span>
          <TextInput
            type="search"
            value={query}
            placeholder="Name or reference"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="ns-field">
          <span>Lifecycle</span>
          <Select
            value={lifecycle}
            onChange={(e) => {
              setLifecycle(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All lifecycles</option>
            <option value="lead">Lead</option>
            <option value="prospect">Prospect</option>
            <option value="customer">Customer</option>
            <option value="former_customer">Former customer</option>
            <option value="partner">Partner</option>
          </Select>
        </label>
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
          title="No companies found"
          message="Adjust the filters or add the first company."
        />
      ) : (
        <>
          <DataTable
            caption="Companies"
            columns={["Company", "Industry", "Owner", "Lifecycle", "Updated"]}
          >
            {data.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <a className="ns-record-link" href={`/companies/${item.id}`}>
                    <strong>{item.name}</strong>
                  </a>
                  <br />
                  <small>
                    {item.organizationNumber ??
                      item.externalReference ??
                      "No reference"}
                  </small>
                </td>
                <td>{item.industry ?? "—"}</td>
                <td>{item.ownerName ?? "Unassigned"}</td>
                <td>
                  <StatusBadge
                    tone={
                      item.lifecycleStatus === "customer" ? "positive" : "info"
                    }
                  >
                    {item.lifecycleStatus.replaceAll("_", " ")}
                  </StatusBadge>
                </td>
                <td>
                  <time dateTime={item.updatedAt}>
                    {new Date(item.updatedAt).toLocaleString()}
                  </time>
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
        open={dialog}
        title="Add company"
        description="Create a durable account record."
        onClose={() => setDialog(false)}
      >
        <form onSubmit={create}>
          <Field label="Company name" required>
            <TextInput name="name" maxLength={160} required autoFocus />
          </Field>
          <Field label="Organization number">
            <TextInput name="organizationNumber" maxLength={100} />
          </Field>
          <Field label="External reference">
            <TextInput name="externalReference" maxLength={100} />
          </Field>
          <Field label="Website">
            <TextInput name="website" type="url" maxLength={300} />
          </Field>
          <Field label="Phone">
            <TextInput name="phone" maxLength={80} />
          </Field>
          <Field label="Industry">
            <TextInput name="industry" maxLength={100} />
          </Field>
          <Field label="Size">
            <TextInput name="size" maxLength={80} />
          </Field>
          <Field label="Address">
            <TextInput name="address" maxLength={500} />
          </Field>
          <Field label="Lifecycle">
            <Select name="lifecycleStatus" defaultValue="prospect">
              <option value="lead">Lead</option>
              <option value="prospect">Prospect</option>
              <option value="customer">Customer</option>
              <option value="partner">Partner</option>
            </Select>
          </Field>
          <Field label="Tags" hint="Separate tags with commas">
            <TextInput name="tags" />
          </Field>
          <Field label="Description">
            <textarea className="ns-input" name="description" rows={3} />
          </Field>
          <div className="ns-dialog-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setDialog(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create company</Button>
          </div>
        </form>
      </Dialog>
      {toast && (
        <ToastRegion>
          <Toast
            tone={toast === "Company created" ? "success" : "error"}
            title={toast}
            onDismiss={() => setToast("")}
          />
        </ToastRegion>
      )}
    </>
  );
}

function CompanyDetailPage({ id, role }: { id: string; role: UserRole }) {
  const [item, setItem] = useState<CompanyDetail | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "not-found" | "error"
  >("loading");
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(id)}`);
      if (response.status === 404) {
        setState("not-found");
        return;
      }
      if (!response.ok) throw new Error();
      setItem((await response.json()) as CompanyDetail);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const data = new FormData(event.currentTarget);
    const body = {
      name: data.get("name"),
      organizationNumber: data.get("organizationNumber"),
      externalReference: data.get("externalReference"),
      website: data.get("website"),
      phone: data.get("phone"),
      industry: data.get("industry"),
      size: data.get("size"),
      address: data.get("address"),
      lifecycleStatus: data.get("lifecycleStatus"),
      tags: String(data.get("tags") ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      description: data.get("description"),
      ownerId: item.ownerId,
      version: item.version,
    };
    const response = await fetch(`/api/companies/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      setEditing(false);
      setMessage("Company updated");
      await load();
    } else {
      const result = (await response.json()) as { error: { message: string } };
      setMessage(result.error.message);
    }
  }
  async function archive() {
    if (!item) return;
    const response = await fetch(
      `/api/companies/${encodeURIComponent(id)}/${item.archivedAt ? "restore" : "archive"}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    if (response.ok) {
      setConfirmArchive(false);
      setMessage(item.archivedAt ? "Company restored" : "Company archived");
      await load();
    }
  }
  if (state === "loading") return <OperationalState kind="loading" />;
  if (state === "not-found") return <OperationalState kind="not-found" />;
  if (state === "error" || !item)
    return (
      <OperationalState
        kind="error"
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={item.archivedAt ? "Archived company" : "Company"}
        title={item.name}
        description={
          item.organizationNumber ??
          item.externalReference ??
          "No external reference"
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()}>
              Back
            </Button>
            {role !== "viewer" && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  variant={item.archivedAt ? "secondary" : "danger"}
                  onClick={() =>
                    item.archivedAt ? void archive() : setConfirmArchive(true)
                  }
                >
                  {item.archivedAt ? "Restore" : "Archive"}
                </Button>
              </>
            )}
          </>
        }
      />
      <section className="ns-company-detail">
        <dl>
          <dt>Lifecycle</dt>
          <dd>{item.lifecycleStatus.replaceAll("_", " ")}</dd>
          <dt>Owner</dt>
          <dd>{item.ownerName ?? "Unassigned"}</dd>
          <dt>Industry / size</dt>
          <dd>
            {[item.industry, item.size].filter(Boolean).join(" · ") || "—"}
          </dd>
          <dt>Website</dt>
          <dd>
            {item.website ? <a href={item.website}>{item.website}</a> : "—"}
          </dd>
          <dt>Phone</dt>
          <dd>{item.phone ?? "—"}</dd>
          <dt>Address</dt>
          <dd>{item.address ?? "—"}</dd>
          <dt>Tags</dt>
          <dd>{item.tags.join(", ") || "—"}</dd>
          <dt>Description</dt>
          <dd>{item.description || "—"}</dd>
        </dl>
        <div>
          <h2>Related work</h2>
          <ul>
            {Object.entries(item.related).map(([label, count]) => (
              <li key={label}>
                <strong>{count}</strong> {label}
              </li>
            ))}
          </ul>
          <h2>Shared activity history</h2>
          {item.activities.length ? (
            <ol>
              {item.activities.map((activity) => (
                <li key={activity.id}>
                  <a
                    href={`/activities?companyId=${encodeURIComponent(item.id)}`}
                  >
                    {activity.subject}
                  </a>{" "}
                  <small>
                    {activity.type.replaceAll("_", " ")} ·{" "}
                    {activity.creatorLabel} ·{" "}
                    <time dateTime={activity.occurredAt}>
                      {new Date(activity.occurredAt).toLocaleString()}
                    </time>
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No activities recorded.</p>
          )}
          <h2>Change history</h2>
          {item.history.length ? (
            <ol>
              {item.history.map((entry, index) => (
                <li key={`${entry.occurredAt}-${index}`}>
                  {entry.action.replace("company.", "")} ·{" "}
                  <time dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>No changes recorded yet.</p>
          )}
        </div>
      </section>
      <Dialog
        open={editing}
        title="Edit company"
        onClose={() => setEditing(false)}
      >
        <form onSubmit={save}>
          <Field label="Company name" required>
            <TextInput
              name="name"
              defaultValue={item.name}
              required
              maxLength={160}
            />
          </Field>
          <Field label="Organization number">
            <TextInput
              name="organizationNumber"
              defaultValue={item.organizationNumber ?? ""}
            />
          </Field>
          <Field label="External reference">
            <TextInput
              name="externalReference"
              defaultValue={item.externalReference ?? ""}
            />
          </Field>
          <Field label="Website">
            <TextInput
              name="website"
              type="url"
              defaultValue={item.website ?? ""}
            />
          </Field>
          <Field label="Phone">
            <TextInput name="phone" defaultValue={item.phone ?? ""} />
          </Field>
          <Field label="Industry">
            <TextInput name="industry" defaultValue={item.industry ?? ""} />
          </Field>
          <Field label="Size">
            <TextInput name="size" defaultValue={item.size ?? ""} />
          </Field>
          <Field label="Address">
            <TextInput name="address" defaultValue={item.address ?? ""} />
          </Field>
          <Field label="Lifecycle">
            <Select name="lifecycleStatus" defaultValue={item.lifecycleStatus}>
              {[
                "lead",
                "prospect",
                "customer",
                "former_customer",
                "partner",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags">
            <TextInput name="tags" defaultValue={item.tags.join(", ")} />
          </Field>
          <Field label="Description">
            <textarea
              className="ns-input"
              name="description"
              rows={3}
              defaultValue={item.description}
            />
          </Field>
          <div className="ns-dialog-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${item.name}?`}
        consequences={`The company will leave active lists. Its ${item.related.contacts} contacts, ${item.related.deals} deals, ${item.related.tasks} tasks, and ${item.related.activities} historical activities remain preserved.`}
        confirmLabel="Archive company"
        danger
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      />
      {message && (
        <ToastRegion>
          <Toast
            tone={message.includes("changed") ? "error" : "success"}
            title={message}
            onDismiss={() => setMessage("")}
          />
        </ToastRegion>
      )}
    </>
  );
}
