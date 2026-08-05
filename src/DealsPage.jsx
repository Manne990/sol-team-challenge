import React, { useEffect, useState } from "react";
import { Button, DataTable, Dialog, OperationalState } from "./components.jsx";
import { SavedViews } from "./Discovery.jsx";

async function api(path, options) {
  const response = await fetch(`/api/deals${path}`, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-northstar-ui-request": "true",
    },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const error = new Error(
      body?.error?.message || "Could not complete the deal request.",
    );
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}
const money = (minor, currency) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    minor / 100,
  );
const empty = {
  name: "",
  companyId: "",
  contactIds: "",
  ownerMembershipId: "",
  stageId: "",
  amount: "",
  currency: "SEK",
  expectedCloseDate: "",
  probability: "50",
};
function DealForm({ deal, stages, user, onCancel, onSaved }) {
  const [form, setForm] = useState(
      deal
        ? {
            ...deal,
            companyId: deal.company.id,
            contactIds: deal.contacts.map((x) => x.id).join(", "),
            ownerMembershipId: deal.owner.id,
            stageId: deal.stage.id,
            amount: (deal.amountMinor / 100).toFixed(2),
          }
        : {
            ...empty,
            ownerMembershipId: user?.membershipId || "",
            stageId: stages.find((x) => !x.isLost)?.id || "",
          },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        companyId: form.companyId,
        contactIds: form.contactIds
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        ownerMembershipId: form.ownerMembershipId,
        stageId: form.stageId,
        amountMinor: Math.round(Number(form.amount) * 100),
        currency: form.currency,
        expectedCloseDate: form.expectedCloseDate || null,
        probability: Number(form.probability),
        ...(deal ? { version: deal.version } : {}),
      };
      const result = await api(deal ? `/${deal.id}` : "", {
        method: deal ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved(result.deal);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="company-form" onSubmit={submit}>
      <h2>{deal ? "Edit deal" : "Add deal"}</h2>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <div className="company-form__grid">
        <label>
          Deal name *
          <input
            required
            maxLength="160"
            value={form.name}
            onChange={set("name")}
          />
        </label>
        <label>
          Company ID *
          <input required value={form.companyId} onChange={set("companyId")} />
        </label>
        <label>
          Owner membership ID *
          <input
            required
            value={form.ownerMembershipId}
            onChange={set("ownerMembershipId")}
          />
        </label>
        <label>
          Stage *
          <select
            value={form.stageId}
            onChange={set("stageId")}
            disabled={Boolean(deal)}
          >
            {stages
              .filter((x) => x.active)
              .map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
          {deal && (
            <small>Use Move deal to change stage and preserve history.</small>
          )}
        </label>
        <label>
          Amount *
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={set("amount")}
          />
        </label>
        <label>
          Currency *
          <input
            required
            pattern="[A-Za-z]{3}"
            maxLength="3"
            value={form.currency}
            onChange={set("currency")}
          />
        </label>
        <label>
          Expected close date
          <input
            type="date"
            value={form.expectedCloseDate || ""}
            onChange={set("expectedCloseDate")}
          />
        </label>
        <label>
          Probability %
          <input
            required
            type="number"
            min="0"
            max="100"
            value={form.probability}
            onChange={set("probability")}
          />
        </label>
        <label className="wide">
          Contact IDs, comma separated
          <input value={form.contactIds} onChange={set("contactIds")} />
        </label>
      </div>
      <div className="form-actions">
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={busy}>{busy ? "Saving…" : "Save deal"}</Button>
      </div>
    </form>
  );
}
function MoveDeal({ deal, stages, onClose, onSaved }) {
  const [stageId, setStageId] = useState(deal.stage.id),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const target = stages.find((x) => x.id === stageId);
  return (
    <Dialog
      open
      title={`Move ${deal.name}`}
      description="Choose a stage. This records an immutable transition in deal history."
      confirmLabel="Move deal"
      onClose={onClose}
      onConfirm={async () => {
        try {
          const result = await api(`/${deal.id}/transition`, {
            method: "POST",
            body: JSON.stringify({
              stageId,
              version: deal.version,
              lossReason: target?.isLost ? reason : null,
            }),
          });
          onSaved(result.deal);
        } catch (e) {
          setError(e.message);
        }
      }}
    >
      <select
        aria-label="Destination stage"
        value={stageId}
        onChange={(e) => setStageId(e.target.value)}
      >
        {stages
          .filter((x) => x.active)
          .map((x) => (
            <option value={x.id} key={x.id}>
              {x.name}
            </option>
          ))}
      </select>
      {target?.isLost && (
        <input
          aria-label="Loss reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}{" "}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}

function StageManager({ stages, onClose, onChanged }) {
  const [name, setName] = useState(""),
    [color, setColor] = useState("#336699"),
    [outcome, setOutcome] = useState("open"),
    [error, setError] = useState("");
  return (
    <Dialog
      open
      title="Manage pipeline stages"
      description="New deals use active stages. Deactivating one preserves existing deals and transitions."
      confirmLabel="Done"
      onClose={onClose}
      onConfirm={onClose}
    >
      {error && <p role="alert">{error}</p>}
      <div className="stage-list">
        {stages.map((stage, index) => (
          <div key={stage.id}>
            <span style={{ background: stage.color }} />
            <strong>{stage.name}</strong>
            <small>{stage.active ? "Active" : "Inactive"}</small>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api(`/stages/${stage.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      version: stage.version,
                      name: stage.name,
                      color: stage.color,
                      active: !stage.active,
                    }),
                  });
                  onChanged();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              {stage.active ? "Deactivate" : "Activate"} {stage.name}
            </button>
            <span className="stage-order">
              <button
                type="button"
                disabled={index === 0}
                aria-label={`Move ${stage.name} earlier`}
                onClick={async () => {
                  await api(`/stages/${stage.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      version: stage.version,
                      position: index - 1,
                    }),
                  });
                  onChanged();
                }}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === stages.length - 1}
                aria-label={`Move ${stage.name} later`}
                onClick={async () => {
                  await api(`/stages/${stage.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      version: stage.version,
                      position: index + 1,
                    }),
                  });
                  onChanged();
                }}
              >
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>
      <form
        className="stage-create"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await api("/stages", {
              method: "POST",
              body: JSON.stringify({ name, color, outcome }),
            });
            setName("");
            onChanged();
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <label>
          Stage name
          <input
            required
            maxLength="80"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </label>
        <Button type="submit">Add stage</Button>
      </form>
    </Dialog>
  );
}

export function DealsPage({ role, user, dealId }) {
  const [state, setState] = useState({ status: "loading" }),
    [stages, setStages] = useState([]),
    [editing, setEditing] = useState(false),
    [moving, setMoving] = useState(false),
    [managingStages, setManagingStages] = useState(false),
    [view, setView] = useState("pipeline"),
    [filters, setFilters] = useState(
      () => new URLSearchParams(location.hash.split("?")[1] || ""),
    );
  const canEdit = role !== "viewer";
  const load = () => {
    setState({ status: "loading" });
    Promise.all([
      api(dealId ? `/${dealId}` : `?${filters}`),
      api("/stages?includeInactive=true"),
    ])
      .then(([data, s]) => {
        setStages(s.stages);
        setState({ status: "ready", data: dealId ? data.deal : data });
      })
      .catch((error) =>
        setState({
          status: error.code === "NOT_FOUND" ? "not-found" : "error",
          error,
        }),
      );
  };
  useEffect(load, [dealId, filters.toString()]);
  if (state.status === "loading") return <OperationalState type="loading" />;
  if (state.status !== "ready")
    return (
      <OperationalState type={state.status} message={state.error?.message} />
    );
  if (editing)
    return (
      <DealForm
        deal={editing === true ? undefined : editing}
        stages={stages}
        user={user}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          if (dealId) setState({ status: "ready", data: saved });
          else load();
        }}
      />
    );
  if (dealId) {
    const d = state.data;
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Deal detail</p>
            <h1>{d.name}</h1>
            <p>
              {money(d.amountMinor, d.currency)} · {d.status} · {d.probability}%
              probability
            </p>
          </div>
          {canEdit && (
            <div className="heading-actions">
              <Button variant="quiet" onClick={() => setEditing(d)}>
                Edit
              </Button>
              <Button onClick={() => setMoving(true)}>Move deal</Button>
              <Button
                variant={d.archivedAt ? "primary" : "danger"}
                onClick={async () => {
                  await api(
                    `/${d.id}/${d.archivedAt ? "restore" : "archive"}`,
                    { method: "POST" },
                  );
                  load();
                }}
              >
                {d.archivedAt ? "Restore" : "Archive"}
              </Button>
            </div>
          )}
        </div>
        <section className="panel company-detail">
          <dl>
            <div>
              <dt>Company</dt>
              <dd>{d.company.name}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{d.owner.name}</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{d.stage.name}</dd>
            </div>
            <div>
              <dt>Expected close</dt>
              <dd>{d.expectedCloseDate || "—"}</dd>
            </div>
            <div>
              <dt>Contacts</dt>
              <dd>{d.contacts.map((x) => x.name).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Loss reason</dt>
              <dd>{d.lossReason || "—"}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <div className="panel__heading">
            <h2>Stage history</h2>
          </div>
          {d.history.length ? (
            <ol className="history">
              {d.history.map((x) => (
                <li key={x.id}>
                  <span>
                    {x.fromStage || "Created"} → <strong>{x.toStage}</strong>
                  </span>
                  <time>{new Date(x.movedAt).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          ) : (
            <OperationalState type="empty" />
          )}
        </section>
        {moving && (
          <MoveDeal
            deal={d}
            stages={stages}
            onClose={() => setMoving(false)}
            onSaved={(saved) => {
              setMoving(false);
              setState({ status: "ready", data: saved });
            }}
          />
        )}
      </>
    );
  }
  const result = state.data,
    update = (key, value) => {
      const next = new URLSearchParams(filters);
      if (value) next.set(key, value);
      else next.delete(key);
      setFilters(next);
      location.hash = `deals?${next}`;
    };
  const columns = [
    {
      key: "name",
      label: "Deal",
      render: (d) => <a href={`#deals/${d.id}`}>{d.name}</a>,
    },
    { key: "company", label: "Company", render: (d) => d.company.name },
    { key: "stage", label: "Stage", render: (d) => d.stage.name },
    {
      key: "amountMinor",
      label: "Amount",
      render: (d) => money(d.amountMinor, d.currency),
    },
    {
      key: "probability",
      label: "Probability",
      render: (d) => `${d.probability}%`,
    },
    { key: "expectedCloseDate", label: "Expected close" },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Sales</p>
          <h1>Deals</h1>
          <p>
            {result.pagination.total} deals ·{" "}
            {result.totals
              .map((x) => money(x.amountMinor, x.currency))
              .join(" + ") || "No pipeline value"}
          </p>
        </div>
        <div className="heading-actions">
          {role === "owner" && (
            <Button variant="quiet" onClick={() => setManagingStages(true)}>
              Manage stages
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => setEditing(true)}>+ Add deal</Button>
          )}
        </div>
      </div>
      <SavedViews
        resource="deals"
        definition={Object.fromEntries(filters)}
        onApply={(value) => {
          const next = new URLSearchParams(value);
          setFilters(next);
          location.hash = `deals${next.size ? `?${next}` : ""}`;
        }}
      />
      <section className="panel">
        <div className="filters deal-filters">
          <label>
            Search
            <input
              type="search"
              value={filters.get("q") || ""}
              onChange={(e) => update("q", e.target.value)}
            />
          </label>
          <label>
            Stage
            <select
              value={filters.get("stageId") || ""}
              onChange={(e) => update("stageId", e.target.value)}
            >
              <option value="">All stages</option>
              {stages.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={filters.get("status") || ""}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">All</option>
              <option>open</option>
              <option>won</option>
              <option>lost</option>
            </select>
          </label>
          <div className="view-switch" aria-label="Deal view">
            <Button
              variant={view === "pipeline" ? "primary" : "quiet"}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </Button>
            <Button
              variant={view === "list" ? "primary" : "quiet"}
              onClick={() => setView("list")}
            >
              List
            </Button>
          </div>
        </div>
        {view === "list" ? (
          <DataTable caption="Deals" columns={columns} rows={result.deals} />
        ) : (
          <div className="pipeline" aria-label="Pipeline board">
            {stages.map((stage) => {
              const deals = result.deals.filter((d) => d.stage.id === stage.id);
              return (
                <section className="pipeline-column" key={stage.id}>
                  <h2>
                    <span style={{ background: stage.color }} />
                    {stage.name}
                    <small>{deals.length}</small>
                  </h2>
                  {deals.length ? (
                    deals.map((d) => (
                      <article key={d.id}>
                        <a href={`#deals/${d.id}`}>{d.name}</a>
                        <span>{d.company.name}</span>
                        <strong>{money(d.amountMinor, d.currency)}</strong>
                        {canEdit && (
                          <a className="non-drag-move" href={`#deals/${d.id}`}>
                            Move with stage menu
                          </a>
                        )}
                      </article>
                    ))
                  ) : (
                    <p>No deals</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
      {managingStages && (
        <StageManager
          stages={stages}
          onClose={() => setManagingStages(false)}
          onChanged={async () => {
            const result = await api("/stages?includeInactive=true");
            setStages(result.stages);
          }}
        />
      )}
    </>
  );
}
