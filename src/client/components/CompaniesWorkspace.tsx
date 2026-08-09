import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  Company,
  CompanyDetail,
  CompanyInput,
} from "../../shared/companies";
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

type ListResponse = {
  companies: Company[];
  pagination: { page: number; total: number; totalPages: number };
};
const blank: CompanyInput = {
  name: "",
  lifecycleStatus: "prospect",
  organizationNumber: "",
  externalReference: "",
  website: "",
  phone: "",
  industry: "",
  size: "",
  address: {},
  tags: [],
  description: "",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(
      body.error?.message ?? "The request could not be completed.",
    );
  return body;
}

export function CompaniesWorkspace({ role }: { role: UserRole }) {
  const [data, setData] = useState<ListResponse>();
  const [failure, setFailure] = useState("");
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CompanyDetail>();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CompanyInput>(blank);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const mutable = role !== "viewer";
  const load = useCallback(async () => {
    setFailure("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        sort: "name",
      });
      if (query) params.set("q", query);
      if (lifecycle) params.set("lifecycle", lifecycle);
      setData(await request<ListResponse>(`/api/companies?${params}`));
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Companies could not be loaded.",
      );
    }
  }, [page, query, lifecycle]);
  useEffect(() => {
    void load();
  }, [load]);
  async function open(company: Company) {
    try {
      const result = await request<{ company: CompanyDetail }>(
        `/api/companies/${company.id}`,
      );
      setSelected(result.company);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Company could not be loaded.",
      );
    }
  }
  function begin(company?: CompanyDetail) {
    setForm(
      company
        ? {
            name: company.name,
            organizationNumber: company.organizationNumber,
            externalReference: company.externalReference,
            website: company.website,
            phone: company.phone,
            industry: company.industry,
            size: company.size,
            address: company.address,
            lifecycleStatus: company.lifecycleStatus,
            ownerMembershipId: company.owner?.id,
            tags: company.tags,
            description: company.description,
            version: company.version,
          }
        : blank,
    );
    setEditing(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      const result = await request<{ company: CompanyDetail }>(
        selected ? `/api/companies/${selected.id}` : "/api/companies",
        { method: selected ? "PUT" : "POST", body: JSON.stringify(form) },
      );
      setSelected(result.company);
      setEditing(false);
      setNotice(selected ? "Company updated." : "Company created.");
      await load();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Company could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await request<{ company: CompanyDetail }>(
        `/api/companies/${selected.id}/${selected.archivedAt ? "restore" : "archive"}`,
        { method: "POST" },
      );
      setSelected(result.company);
      setConfirmArchive(false);
      setNotice(
        result.company.archivedAt
          ? "Company archived. History was preserved."
          : "Company restored.",
      );
      await load();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Company could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (failure && !data)
    return (
      <OperationalState
        kind="error"
        message={failure}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title={selected ? selected.name : "Companies"}
        description={
          selected
            ? "Account details and connected CRM history."
            : "Scan, filter, and maintain customer and prospect accounts."
        }
        actions={
          mutable ? (
            <>
              {selected && (
                <Button variant="secondary" onClick={() => begin(selected)}>
                  Edit company
                </Button>
              )}
              <Button
                onClick={() => {
                  setSelected(undefined);
                  begin();
                }}
              >
                New company
              </Button>
            </>
          ) : undefined
        }
      />
      {failure && (
        <div role="alert" className="auth-error">
          {failure}
        </div>
      )}
      {selected ? (
        <section>
          <Button variant="quiet" onClick={() => setSelected(undefined)}>
            ← Back to companies
          </Button>
          <dl className="ns-company-facts">
            <div>
              <dt>Lifecycle</dt>
              <dd>
                <StatusBadge
                  tone={
                    selected.lifecycleStatus === "customer"
                      ? "positive"
                      : "info"
                  }
                >
                  {selected.lifecycleStatus}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt>Organization number</dt>
              <dd>{selected.organizationNumber ?? "—"}</dd>
            </div>
            <div>
              <dt>External reference</dt>
              <dd>{selected.externalReference ?? "—"}</dd>
            </div>
            <div>
              <dt>Industry / size</dt>
              <dd>
                {selected.industry ?? "—"} · {selected.size ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{selected.owner?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>
                <time dateTime={selected.updatedAt}>
                  {new Date(selected.updatedAt).toLocaleString()}
                </time>
              </dd>
            </div>
          </dl>
          <h2>Connected history</h2>
          <ul className="ns-related-counts">
            <li>{selected.relatedCounts.contacts} contacts</li>
            <li>{selected.relatedCounts.activities} activities</li>
            <li>{selected.relatedCounts.deals} deals</li>
            <li>{selected.relatedCounts.tasks} tasks</li>
          </ul>
          <h2>Activity timeline</h2>
          {selected.activities?.length ? (
            <ol className="activity-timeline">
              {selected.activities.map((activity) => (
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
                      {activity.creatorLabel}
                    </small>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <p>No activity recorded for this company.</p>
          )}
          <h2>Change history</h2>
          {selected.history.length ? (
            <ol>
              {selected.history.map((item, index) => (
                <li key={`${item.timestamp}-${index}`}>
                  <strong>{item.action.replace("company.", "")}</strong>{" "}
                  <time dateTime={item.timestamp}>
                    {new Date(item.timestamp).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>No changes recorded yet.</p>
          )}
          {mutable && (
            <Button
              variant={selected.archivedAt ? "secondary" : "danger"}
              onClick={() => setConfirmArchive(true)}
            >
              {selected.archivedAt ? "Restore company" : "Archive company"}
            </Button>
          )}
        </section>
      ) : (
        <>
          <FilterBar
            activeCount={Number(Boolean(query)) + Number(Boolean(lifecycle))}
            onClear={() => {
              setQuery("");
              setLifecycle("");
              setPage(1);
            }}
          >
            <Field label="Search">
              <TextInput
                type="search"
                value={query}
                placeholder="Name or reference"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field label="Lifecycle">
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
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          </FilterBar>
          {!data ? (
            <OperationalState kind="loading" />
          ) : data.companies.length === 0 ? (
            <OperationalState
              kind="empty"
              title="No matching companies"
              message="Clear filters or add the first company."
            />
          ) : (
            <>
              <DataTable
                caption="Companies"
                columns={[
                  "Company",
                  "Industry",
                  "Owner",
                  "Lifecycle",
                  "Updated",
                ]}
              >
                {data.companies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <button
                        className="ns-table-link"
                        onClick={() => void open(company)}
                      >
                        <strong>{company.name}</strong>
                      </button>
                      <br />
                      <small>
                        {company.organizationNumber ??
                          company.externalReference ??
                          "No reference"}
                      </small>
                    </td>
                    <td>{company.industry ?? "—"}</td>
                    <td>{company.owner?.name ?? "Unassigned"}</td>
                    <td>
                      <StatusBadge
                        tone={
                          company.lifecycleStatus === "customer"
                            ? "positive"
                            : "info"
                        }
                      >
                        {company.lifecycleStatus}
                      </StatusBadge>
                    </td>
                    <td>
                      <time dateTime={company.updatedAt}>
                        {new Date(company.updatedAt).toLocaleDateString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </DataTable>
              <Pagination
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}
      <Dialog
        open={editing}
        title={selected ? "Edit company" : "Create company"}
        description="Required fields are marked."
        onClose={() => setEditing(false)}
      >
        <form onSubmit={save} className="ns-company-form">
          <Field label="Name" required>
            <TextInput
              required
              maxLength={160}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Lifecycle" required>
            <Select
              value={form.lifecycleStatus}
              onChange={(e) =>
                setForm({
                  ...form,
                  lifecycleStatus: e.target
                    .value as CompanyInput["lifecycleStatus"],
                })
              }
            >
              <option value="lead">Lead</option>
              <option value="prospect">Prospect</option>
              <option value="customer">Customer</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <Field label="Organization number">
            <TextInput
              value={form.organizationNumber ?? ""}
              onChange={(e) =>
                setForm({ ...form, organizationNumber: e.target.value })
              }
            />
          </Field>
          <Field label="External reference">
            <TextInput
              value={form.externalReference ?? ""}
              onChange={(e) =>
                setForm({ ...form, externalReference: e.target.value })
              }
            />
          </Field>
          <Field label="Website">
            <TextInput
              type="url"
              placeholder="https://"
              value={form.website ?? ""}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <TextInput
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Industry">
            <TextInput
              value={form.industry ?? ""}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            />
          </Field>
          <Field label="Size">
            <TextInput
              value={form.size ?? ""}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
            />
          </Field>
          <Field label="Tags" hint="Comma-separated">
            <TextInput
              value={(form.tags ?? []).join(", ")}
              onChange={(e) =>
                setForm({
                  ...form,
                  tags: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Description">
            <textarea
              className="ns-input"
              rows={4}
              value={form.description ?? ""}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
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
            <Button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save company"}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmArchive}
        title={selected?.archivedAt ? "Restore company?" : "Archive company?"}
        consequences={
          selected?.archivedAt
            ? "The company will return to active lists."
            : "The company leaves active lists, while contacts, activities, deals, tasks, and history remain."
        }
        confirmLabel={selected?.archivedAt ? "Restore" : "Archive"}
        danger={!selected?.archivedAt}
        onConfirm={() => void archive()}
        onClose={() => setConfirmArchive(false)}
      />
      <ToastRegion>
        {notice && <Toast title={notice} onDismiss={() => setNotice("")} />}
      </ToastRegion>
    </>
  );
}
