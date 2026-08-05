import React, { useState } from "react";
import { Button, OperationalState } from "./components.jsx";

const supported = {
  companies: [
    "name",
    "organizationNumber",
    "externalReference",
    "website",
    "phone",
    "industry",
    "size",
    "address",
    "lifecycleStatus",
    "tags",
    "description",
  ],
  contacts: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "jobTitle",
    "status",
    "tags",
    "communicationPreference",
    "companyId",
  ],
};
export function ImportsPage({ role }) {
  const [resource, setResource] = useState("companies"),
    [csv, setCsv] = useState(""),
    [headers, setHeaders] = useState([]),
    [mapping, setMapping] = useState({}),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(null);
  const companyFilters = new URLSearchParams(
    sessionStorage.getItem("northstar:company-filters") || "",
  );
  const contactFilters = new URLSearchParams(
    sessionStorage.getItem("northstar:contact-filters") || "",
  );
  for (const filters of [companyFilters, contactFilters]) {
    filters.delete("page");
    filters.delete("pageSize");
    filters.delete("sort");
    filters.delete("order");
    filters.delete("direction");
  }
  const companyExport = `/api/imports/export/companies${companyFilters.size ? `?${companyFilters}` : ""}`;
  const contactExport = `/api/imports/export/contacts${contactFilters.size ? `?${contactFilters}` : ""}`;
  const canImport = role !== "viewer";
  function choose(event) {
    const file = event.target.files?.[0];
    setError("");
    setPreview(null);
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("CSV files must be 1 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const first = text.split(/\r?\n/u)[0] || "";
      const columns = first
        .split(",")
        .map((x) => x.replace(/^"|"$/gu, "").trim());
      setCsv(text);
      setHeaders(columns);
      setMapping(
        Object.fromEntries(
          supported[resource]
            .filter((field) => columns.includes(field))
            .map((field) => [field, field]),
        ),
      );
    };
    reader.readAsText(file, "UTF-8");
  }
  async function request(path, options) {
    const response = await fetch(`/api/imports${path}`, {
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-northstar-ui-request": "true",
      },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error)
      throw new Error(body?.error?.message || "Import failed.");
    return body;
  }
  async function previewRows() {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await request("/preview", {
          method: "POST",
          body: JSON.stringify({ resource, csv, mapping }),
        }),
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await request(`/${preview.importId}/commit`, { method: "POST" }),
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Data movement</p>
          <h1>Imports & exports</h1>
          <p>Preview every row before making durable CRM changes.</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel__heading">
          <div>
            <h2>Filtered exports</h2>
            <p>Stable UTF-8 columns from your active organization.</p>
          </div>
        </div>
        <div className="import-actions">
          <a className="button button--quiet" href={companyExport}>
            Export companies
          </a>
          <a className="button button--quiet" href={contactExport}>
            Export contacts
          </a>
        </div>
      </section>
      {canImport ? (
        <section className="panel import-panel">
          <div className="panel__heading">
            <div>
              <h2>CSV import</h2>
              <p>
                Only valid rows commit; warning and invalid rows remain reported
                and unchanged.
              </p>
            </div>
          </div>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          {result ? (
            <OperationalState
              type="empty"
              title="Import committed"
              message={`${result.committed} rows committed; ${result.warnings || 0} warning and ${result.invalid} invalid rows skipped.`}
            />
          ) : (
            <>
              <div className="import-controls">
                <label>
                  Record type
                  <select
                    value={resource}
                    onChange={(e) => {
                      setResource(e.target.value);
                      setCsv("");
                      setHeaders([]);
                      setPreview(null);
                    }}
                  >
                    <option value="companies">Companies</option>
                    <option value="contacts">Contacts</option>
                  </select>
                </label>
                <label>
                  UTF-8 CSV file
                  <input type="file" accept=".csv,text/csv" onChange={choose} />
                </label>
              </div>
              {headers.length > 0 && (
                <>
                  <div className="mapping-grid">
                    <h3>Map columns</h3>
                    {supported[resource].map((field) => (
                      <label key={field}>
                        {field}
                        {["name", "firstName", "lastName"].includes(field) &&
                          " *"}
                        <select
                          value={mapping[field] || ""}
                          onChange={(e) =>
                            setMapping({ ...mapping, [field]: e.target.value })
                          }
                        >
                          <option value="">Not mapped</option>
                          {headers.map((header) => (
                            <option key={header}>{header}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="form-actions">
                    <Button disabled={busy || !csv} onClick={previewRows}>
                      {busy ? "Validating…" : "Preview rows"}
                    </Button>
                  </div>
                </>
              )}
              {preview && (
                <>
                  <div className="import-summary" role="status">
                    <strong>
                      {
                        preview.rows.filter((row) => row.status !== "invalid")
                          .length
                      }
                    </strong>{" "}
                    ready ·{" "}
                    <strong>
                      {
                        preview.rows.filter((row) => row.status === "invalid")
                          .length
                      }
                    </strong>{" "}
                    invalid {preview.replayed && "· replayed preview"}
                  </div>
                  <div className="table-scroll">
                    <table>
                      <caption>Import preview</caption>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Status</th>
                          <th>Normalized data</th>
                          <th>Messages</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row) => (
                          <tr key={row.rowNumber}>
                            <td>{row.rowNumber}</td>
                            <td>
                              <span
                                className={`row-status row-status--${row.status}`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td className="wrap">
                              {JSON.stringify(row.normalized)}
                            </td>
                            <td className="wrap">
                              {[
                                ...(row.errors || []),
                                ...(row.warnings || []),
                              ].join("; ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="form-actions">
                    <Button
                      disabled={
                        busy ||
                        preview.rows.every((row) => row.status !== "valid")
                      }
                      onClick={commit}
                    >
                      {busy ? "Committing…" : "Commit valid rows"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      ) : (
        <OperationalState
          type="forbidden"
          title="Import is read-only for viewers"
          message="You can export authorized data, but only owners and members can import records."
        />
      )}
    </>
  );
}
