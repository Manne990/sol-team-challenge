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
};
type Payload = { items: Deal[]; stages: Stage[]; total: number };

export function DealsPage({
  role,
  userId,
}: {
  role: UserRole;
  userId: string;
}) {
  const initial = new URLSearchParams(location.search);
  const [status, setStatus] = useState(initial.get("status") ?? "open");
  const [view, setView] = useState(initial.get("view") ?? "pipeline");
  const closeFrom = initial.get("closeFrom") ?? "";
  const closeTo = initial.get("closeTo") ?? "";
  const [data, setData] = useState<Payload>({
    items: [],
    stages: [],
    total: 0,
  });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    const params = new URLSearchParams({ status, view });
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
  }, [status, view, closeFrom, closeTo]);
  useEffect(() => {
    void load();
  }, [load]);
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
        contactIds: [],
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
  return (
    <>
      <PageHeader
        eyebrow={`${data.total} deals`}
        title="Deals"
        description="Pipeline value, outcomes, and stage history."
        actions={
          role !== "viewer" ? (
            <Button onClick={() => setDialog(true)}>Add deal</Button>
          ) : undefined
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
        <DealTable deals={data.items} />
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
          <Button type="submit">Create deal</Button>
        </form>
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
function DealTable({ deals }: { deals: Deal[] }) {
  return (
    <DataTable
      caption="Deals"
      columns={["Deal", "Company", "Stage", "Value", "Probability", "Status"]}
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
        </tr>
      ))}
    </DataTable>
  );
}
