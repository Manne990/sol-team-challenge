import React, { useEffect, useState } from "react";
import { Button, OperationalState } from "./components.jsx";
const api = async (path, options) => {
  const response = await fetch(`/api/duplicates${path}`, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-northstar-ui-request": "true",
    },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error)
    throw new Error(body?.error?.message || "Duplicate review failed.");
  return body;
};
export function DuplicatesPage({ role }) {
  const [resource, setResource] = useState("companies"),
    [state, setState] = useState({ status: "loading" }),
    [review, setReview] = useState(null),
    [choices, setChoices] = useState({}),
    [error, setError] = useState("");
  const load = () => {
    setState({ status: "loading" });
    api(`/${resource}`)
      .then((data) => setState({ status: "ready", data: data.candidates }))
      .catch((failure) => setState({ status: "error", error: failure }));
  };
  useEffect(load, [resource]);
  if (state.status === "loading") return <OperationalState type="loading" />;
  if (state.status === "error")
    return <OperationalState type="error" message={state.error.message} />;
  const candidates = state.data,
    begin = (candidate, survivor) => {
      const retired =
        survivor.id === candidate.left.id ? candidate.right : candidate.left;
      setReview({ candidate, survivor, retired });
      setChoices({ ...survivor.fields });
      setError("");
    };
  const merge = async () => {
    try {
      await api(`/${resource}/merge`, {
        method: "POST",
        body: JSON.stringify({
          survivorId: review.survivor.id,
          retiredId: review.retired.id,
          survivorVersion: review.survivor.version,
          retiredVersion: review.retired.version,
          fields: choices,
        }),
      });
      setReview(null);
      load();
    } catch (failure) {
      setError(failure.message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Data quality</p>
          <h1>Duplicate review</h1>
          <p>
            Suggestions explain normalized matches. Nothing merges without your
            decision.
          </p>
        </div>
        <label>
          Record type{" "}
          <select
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          >
            <option value="companies">Companies</option>
            <option value="contacts">Contacts</option>
          </select>
        </label>
      </div>
      {review ? (
        <section className="panel merge-review">
          <div className="panel__heading">
            <div>
              <h2>Keep {review.survivor.label}</h2>
              <p>
                Retire {review.retired.label} and resolve every mutable field.
              </p>
            </div>
          </div>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <div className="merge-fields">
            {Object.keys(review.survivor.fields).map((field) => (
              <fieldset key={field}>
                <legend>{field}</legend>
                <label>
                  <input
                    type="radio"
                    name={field}
                    checked={
                      JSON.stringify(choices[field] ?? null) ===
                      JSON.stringify(review.survivor.fields[field] ?? null)
                    }
                    onChange={() =>
                      setChoices({
                        ...choices,
                        [field]: review.survivor.fields[field],
                      })
                    }
                  />{" "}
                  {JSON.stringify(review.survivor.fields[field] ?? null)}
                </label>
                <label>
                  <input
                    type="radio"
                    name={field}
                    checked={
                      JSON.stringify(choices[field] ?? null) ===
                      JSON.stringify(review.retired.fields[field] ?? null)
                    }
                    onChange={() =>
                      setChoices({
                        ...choices,
                        [field]: review.retired.fields[field],
                      })
                    }
                  />{" "}
                  {JSON.stringify(review.retired.fields[field] ?? null)}
                </label>
              </fieldset>
            ))}
          </div>
          <div className="form-actions">
            <Button variant="quiet" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={role === "viewer"}
              onClick={merge}
            >
              Merge and retire duplicate
            </Button>
          </div>
        </section>
      ) : candidates.length ? (
        <div className="duplicate-list">
          {candidates.map((candidate) => (
            <article className="panel duplicate-card" key={candidate.id}>
              <div>
                <h2>
                  {candidate.left.label} / {candidate.right.label}
                </h2>
                <p>
                  {candidate.reasons
                    .map((reason) => `${reason.field}: ${reason.normalized}`)
                    .join(" · ")}
                </p>
                {(candidate.left.archived || candidate.right.archived) && (
                  <span className="row-status row-status--warning">
                    Includes archived record
                  </span>
                )}
              </div>
              <div className="heading-actions">
                <Button
                  variant="quiet"
                  disabled={role === "viewer"}
                  onClick={() => begin(candidate, candidate.left)}
                >
                  Keep {candidate.left.label}
                </Button>
                <Button
                  variant="quiet"
                  disabled={role === "viewer"}
                  onClick={() => begin(candidate, candidate.right)}
                >
                  Keep {candidate.right.label}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <OperationalState
          type="empty"
          title="No duplicate suggestions"
          message="No normalized facts currently match. Similar names alone are not merged."
        />
      )}
    </>
  );
}
