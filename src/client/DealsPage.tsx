import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "./components/AppShell";
import {
  Button,
  DataTable,
  Dialog,
  Field,
  FilterBar,
  OperationalState,
  PageHeader,
  Select,
  SaveViewButton,
  StatusBadge,
  TextInput,
  Toast,
  ToastRegion,
} from "./components/ui";

type Stage = {
  id: string;
  name: string;
  position: number;
  color: string;
  deals: Deal[];
};
type Deal = {
  id: string;
  name: string;
  company: { id: string; name: string };
  owner: { id: string; name: string };
  amountMinor: number;
  currency: string;
  probability: number;
  stage: { id: string; name: string; position: number };
  status: string;
  lossReason: string | null;
  expectedCloseDate: string | null;
  version: number;
  contacts?: { id: string; name: string }[];
};
type Payload = { items: Deal[]; stages: Stage[]; total: number };

export function DealsPage({
  role,
  userId,
}: {
  role: UserRole;
  userId: string;
}) {
  const detailId = location.pathname.match(/^\/deals\/([^/]+)$/)?.[1];
  const initial = new URLSearchParams(location.search);
  const [status, setStatus] = useState(initial.get("status") ?? "open");
  const [view, setView] = useState(initial.get("view") ?? "pipeline");
  const [sort, setSort] = useState(initial.get("sort") ?? "stage");
  const [direction, setDirection] = useState(initial.get("direction") ?? "asc");
  const closeFrom = initial.get("closeFrom") ?? "";
  const closeTo = initial.get("closeTo") ?? "";
  const [data, setData] = useState<Payload>({
    items: [],
    stages: [],
    total: 0,
  });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState(false);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    const params = new URLSearchParams({ status, view, sort, direction });
    if (closeFrom) params.set("closeFrom", closeFrom);
    if (closeTo) params.set("closeTo", closeTo);
    history.replaceState(null, "", `/deals?${params}`);
    try {
      const response = await fetch(`/api/deals?${params}`);
      if (!response.ok) throw new Error();
      setData((await response.json()) as Payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [status, view, sort, direction, closeFrom, closeTo]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (detailId) void openDeal(detailId);
  }, [detailId]);
  async function openDeal(id: string) {
    const response = await fetch(`/api/deals/${id}`);
    if (response.ok) setSelected((await response.json()) as Deal);
    else setToast("The requested deal was not found.");
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/deals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        companyId: form.get("companyId"),
        ownerId: userId,
        stageId: form.get("stageId"),
        amountMinor: Math.round(Number(form.get("amount")) * 100),
        currency: form.get("currency"),
        probability: Number(form.get("probability")),
        expectedCloseDate: form.get("expectedCloseDate"),
        contactIds: String(form.get("contactIds") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      }),
    });
    if (response.ok) {
      setDialog(false);
      setToast("Deal created");
      await load();
    } else
      setToast(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function move(deal: Deal, stageId: string) {
    const response = await fetch(`/api/deals/${deal.id}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId, status: "open", version: deal.version }),
    });
    if (response.ok) {
      setToast("Deal moved");
      await load();
    } else
      setToast(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function transition(deal: Deal, nextStatus: "open" | "won" | "lost") {
    const lossReason =
      nextStatus === "lost"
        ? window.prompt(
            "Why was this deal lost? This reason is retained in history.",
          )
        : null;
    if (nextStatus === "lost" && !lossReason?.trim()) return;
    const response = await fetch(`/api/deals/${deal.id}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stageId: deal.stage.id,
        status: nextStatus,
        lossReason,
        version: deal.version,
      }),
    });
    const body = (await response.json()) as Deal & {
      error?: { message: string };
    };
    if (!response.ok) {
      setToast(body.error?.message ?? "Could not update the deal outcome.");
      return;
    }
    setSelected(body);
    setToast(
      nextStatus === "open"
        ? "Deal reopened"
        : nextStatus === "won"
          ? "Deal won"
          : "Deal lost",
    );
    await load();
  }
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/deals/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        companyId: selected.company.id,
        ownerId: selected.owner.id,
        stageId: selected.stage.id,
        amountMinor: Math.round(Number(form.get("amount")) * 100),
        currency: form.get("currency"),
        probability: Number(form.get("probability")),
        expectedCloseDate: form.get("expectedCloseDate"),
        contactIds: String(form.get("contactIds") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
        version: selected.version,
      }),
    });
    const body = (await response.json()) as Deal & {
      error?: { message: string };
    };
    if (!response.ok) {
      setToast(body.error?.message ?? "Could not update the deal.");
      return;
    }
    setSelected(body);
    setEditing(false);
    setToast("Deal updated");
    await load();
  }
  return (
    <>
      <PageHeader
        eyebrow={`${data.total} deals`}
        title="Deals"
        description="Pipeline value, outcomes, and stage history."
        actions={
          <>
            <SaveViewButton
              resource="deals"
              definition={{ status, view, sort, direction }}
            />
            {role !== "viewer" && (
              <Button onClick={() => setDialog(true)}>Add deal</Button>
            )}
          </>
        }
      />
      <FilterBar
        activeCount={Number(Boolean(status))}
        onClear={() => setStatus("")}
      >
        <label className="ns-field">
          <span>Status</span>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </Select>
        </label>
        <Field label="Sort by">
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="stage">Stage</option>
            <option value="name">Name</option>
            <option value="amount">Value</option>
            <option value="closeDate">Close date</option>
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
        <label className="ns-field">
          <span>View</span>
          <Select
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="pipeline">Pipeline</option>
            <option value="list">List</option>
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
        <OperationalState kind="empty" title="No deals found" />
      ) : view === "list" ? (
        <DealTable
          deals={data.items}
          onOpen={(deal) => void openDeal(deal.id)}
        />
      ) : (
        <section className="ns-pipeline" aria-label="Sales pipeline">
          {data.stages.map((stage) => (
            <section key={stage.id} className="ns-pipeline-stage">
              <h2>
                {stage.name}{" "}
                <span className="ns-count">{stage.deals.length}</span>
              </h2>
              {stage.deals.map((deal) => (
                <article key={deal.id} className="ns-pipeline-deal">
                  <h3>{deal.name}</h3>
                  <p>{deal.company.name}</p>
                  <strong>{money(deal)}</strong>
                  <p>{deal.probability}% probability</p>
                  <Button
                    variant="quiet"
                    onClick={() => void openDeal(deal.id)}
                  >
                    View deal
                  </Button>
                  {role !== "viewer" && (
                    <label className="ns-field">
                      <span>Move without dragging</span>
                      <Select
                        aria-label={`Move ${deal.name}`}
                        value={deal.stage.id}
                        onChange={(event) =>
                          void move(deal, event.target.value)
                        }
                      >
                        {data.stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                </article>
              ))}
            </section>
          ))}
        </section>
      )}
      <Dialog
        open={dialog}
        title="Add deal"
        description="Create an open pipeline opportunity."
        onClose={() => setDialog(false)}
      >
        <form onSubmit={create}>
          <Field label="Deal name" required>
            <TextInput name="name" required autoFocus />
          </Field>
          <Field
            label="Company ID"
            hint="Choose a company identifier from its detail URL."
            required
          >
            <TextInput name="companyId" required />
          </Field>
          <Field label="Stage" required>
            <Select name="stageId" required>
              {data.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" required>
            <TextInput
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
            />
          </Field>
          <Field label="Currency" required>
            <TextInput
              name="currency"
              defaultValue="SEK"
              pattern="[A-Za-z]{3}"
              required
            />
          </Field>
          <Field label="Probability" required>
            <TextInput
              name="probability"
              type="number"
              min="0"
              max="100"
              defaultValue="20"
              required
            />
          </Field>
          <Field label="Expected close date">
            <TextInput name="expectedCloseDate" type="date" />
          </Field>
          <Field
            label="Contact IDs"
            hint="Separate multiple contact IDs with commas."
          >
            <TextInput name="contactIds" />
          </Field>
          <Button type="submit">Create deal</Button>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(selected) && !editing}
        title={selected?.name ?? "Deal detail"}
        description="Deal value, stage, outcome, and loss reason."
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div>
            <dl>
              <dt>Company</dt>
              <dd>{selected.company.name}</dd>
              <dt>Owner</dt>
              <dd>{selected.owner.name}</dd>
              <dt>Stage</dt>
              <dd>{selected.stage.name}</dd>
              <dt>Value</dt>
              <dd>{money(selected)}</dd>
              <dt>Status</dt>
              <dd>{selected.status}</dd>
              <dt>Loss reason</dt>
              <dd>{selected.lossReason ?? "—"}</dd>
              <dt>Contacts</dt>
              <dd>
                {selected.contacts?.map((contact) => contact.name).join(", ") ||
                  "—"}
              </dd>
            </dl>
            {role !== "viewer" && (
              <div className="ns-dialog-actions">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit deal
                </Button>
                {selected.status === "open" ? (
                  <>
                    <Button onClick={() => void transition(selected, "won")}>
                      Mark won
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void transition(selected, "lost")}
                    >
                      Mark lost
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => void transition(selected, "open")}>
                    Reopen deal
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(selected) && editing}
        title="Edit deal"
        description="Concurrent changes are detected before saving."
        onClose={() => setEditing(false)}
      >
        {selected && (
          <form onSubmit={update}>
            <Field label="Deal name" required>
              <TextInput
                name="name"
                defaultValue={selected.name}
                required
                autoFocus
              />
            </Field>
            <Field label="Amount" required>
              <TextInput
                name="amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={selected.amountMinor / 100}
                required
              />
            </Field>
            <Field label="Currency" required>
              <TextInput
                name="currency"
                defaultValue={selected.currency}
                pattern="[A-Za-z]{3}"
                required
              />
            </Field>
            <Field label="Probability" required>
              <TextInput
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={selected.probability}
                required
              />
            </Field>
            <Field label="Expected close date">
              <TextInput
                name="expectedCloseDate"
                type="date"
                defaultValue={selected.expectedCloseDate ?? ""}
              />
            </Field>
            <Field
              label="Contact IDs"
              hint="Separate multiple contact IDs with commas."
            >
              <TextInput
                name="contactIds"
                defaultValue={
                  selected.contacts?.map((contact) => contact.id).join(", ") ??
                  ""
                }
              />
            </Field>
            <Button type="submit">Save deal</Button>
          </form>
        )}
      </Dialog>
      <ToastRegion>
        {toast && <Toast title={toast} onDismiss={() => setToast("")} />}
      </ToastRegion>
    </>
  );
}
function money(deal: Deal) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: deal.currency,
  }).format(deal.amountMinor / 100);
}
function DealTable({
  deals,
  onOpen,
}: {
  deals: Deal[];
  onOpen: (deal: Deal) => void;
}) {
  return (
    <DataTable
      caption="Deals"
      columns={[
        "Deal",
        "Company",
        "Stage",
        "Value",
        "Probability",
        "Status",
        "Action",
      ]}
    >
      {deals.map((deal) => (
        <tr key={deal.id}>
          <td>
            <strong>{deal.name}</strong>
          </td>
          <td>{deal.company.name}</td>
          <td>{deal.stage.name}</td>
          <td>{money(deal)}</td>
          <td>{deal.probability}%</td>
          <td>
            <StatusBadge
              tone={
                deal.status === "won"
                  ? "positive"
                  : deal.status === "lost"
                    ? "danger"
                    : "info"
              }
            >
              {deal.status}
            </StatusBadge>
          </td>
          <td>
            <Button variant="quiet" onClick={() => onOpen(deal)}>
              View deal
            </Button>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
