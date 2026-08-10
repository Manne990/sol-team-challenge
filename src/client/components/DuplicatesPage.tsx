import { useCallback, useEffect, useState } from "react";
import type { UserRole } from "./AppShell";
import {
  Button,
  Field,
  OperationalState,
  PageHeader,
  Select,
  Toast,
  ToastRegion,
} from "./ui";

type EntityType = "company" | "contact";
type RecordChoice = { id: string; version: number; label: string };
type Candidate = {
  candidateId: string;
  records: [RecordChoice, RecordChoice];
  triggers: { field: string; normalizedValue: string }[];
};

export function DuplicatesPage({ role }: { role: UserRole }) {
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [review, setReview] = useState<Candidate | null>(null);
  const [survivorId, setSurvivorId] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/duplicates/${entityType}`);
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { candidates: Candidate[] };
      setCandidates(body.candidates);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [entityType]);
  useEffect(() => void load(), [load]);

  async function merge() {
    if (!review || !survivorId) return;
    const survivor = review.records.find((record) => record.id === survivorId)!;
    const retired = review.records.find((record) => record.id !== survivorId)!;
    const detailResponse = await fetch(
      `/api/${entityType === "company" ? "companies" : "contacts"}/${survivor.id}`,
    );
    if (!detailResponse.ok) {
      setNotice(
        "The selected survivor could not be loaded. Reload the review.",
      );
      return;
    }
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    const response = await fetch(`/api/duplicates/${entityType}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        survivorId: survivor.id,
        retiredId: retired.id,
        survivorVersion: survivor.version,
        retiredVersion: retired.version,
        idempotencyKey: crypto.randomUUID(),
        fields: mergeFields(entityType, detail),
      }),
    });
    const body = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      setNotice(body.error?.message ?? "The records could not be merged.");
      return;
    }
    setReview(null);
    setSurvivorId("");
    setNotice(
      "Records merged. History and retired-identifier redirects were preserved.",
    );
    await load();
  }

  return (
    <>
      <PageHeader
        eyebrow="Data quality"
        title="Duplicate review"
        description="Compare explainable suggestions. Nothing is merged automatically."
      />
      <Field label="Record type">
        <Select
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value as EntityType);
            setReview(null);
          }}
        >
          <option value="company">Companies</option>
          <option value="contact">Contacts</option>
        </Select>
      </Field>
      {state === "loading" ? (
        <OperationalState kind="loading" />
      ) : state === "error" ? (
        <OperationalState
          kind="error"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : candidates.length === 0 ? (
        <OperationalState
          kind="empty"
          title="No duplicate suggestions"
          message="No matching normalized facts were found."
        />
      ) : (
        <div className="ns-stack">
          {candidates.map((candidate) => (
            <section key={candidate.candidateId} className="ns-panel">
              <h2>
                {candidate.records.map((record) => record.label).join(" or ")}
              </h2>
              <p>
                Suggested because{" "}
                {candidate.triggers
                  .map(
                    (trigger) => `${trigger.field}: ${trigger.normalizedValue}`,
                  )
                  .join(", ")}
                .
              </p>
              <Button
                disabled={role === "viewer"}
                onClick={() => {
                  setReview(candidate);
                  setSurvivorId(candidate.records[0].id);
                }}
              >
                Compare and merge
              </Button>
            </section>
          ))}
        </div>
      )}
      {review && (
        <section className="ns-panel" aria-labelledby="merge-review-title">
          <h2 id="merge-review-title">Choose the surviving record</h2>
          <p>
            Relations and history move to the survivor. The retired identifier
            redirects to it and cannot become active again.
          </p>
          <Field label="Survivor">
            <Select
              value={survivorId}
              onChange={(event) => setSurvivorId(event.target.value)}
            >
              {review.records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="ns-dialog-actions">
            <Button variant="secondary" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void merge()}>
              Merge records
            </Button>
          </div>
        </section>
      )}
      <ToastRegion>
        {notice && <Toast title={notice} onDismiss={() => setNotice("")} />}
      </ToastRegion>
    </>
  );
}

function mergeFields(type: EntityType, detail: Record<string, unknown>) {
  if (type === "company")
    return {
      name: detail.name,
      organization_number: detail.organizationNumber,
      external_reference: detail.externalReference,
      website: detail.website,
      phone: detail.phone,
      industry: detail.industry,
      size: detail.size,
      address: detail.address,
      lifecycle_status: detail.lifecycleStatus,
      owner_id: detail.ownerId,
      tags_json: detail.tags,
      description: detail.description,
    };
  return {
    company_id:
      detail.companyId ??
      (detail.company as { id?: string } | null)?.id ??
      null,
    first_name: detail.firstName,
    last_name: detail.lastName,
    email: detail.email,
    phone: detail.phone,
    job_title: detail.jobTitle,
    owner_id: detail.ownerId,
    status: detail.status,
    tags_json: detail.tags,
    communication_preference: detail.communicationPreference,
  };
}
