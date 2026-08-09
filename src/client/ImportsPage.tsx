import { useMemo, useState, type ChangeEvent } from "react";
import type { UserRole } from "./components";
import {
  Button,
  OperationalState,
  PageHeader,
  Select,
  StatusBadge,
} from "./components";

type Resource = "companies" | "contacts";
type Preview = {
  importId: string;
  status: string;
  summary: {
    total: number;
    valid: number;
    warnings: number;
    invalid: number;
    commitPolicy: string;
  };
  rows: Array<{
    rowNumber: number;
    status: "valid" | "warning" | "invalid" | "committed";
    normalized: Record<string, unknown>;
    errors: string[];
    warnings: string[];
  }>;
};
const fields = {
  companies: [
    ["name", "Name *"],
    ["organizationNumber", "Organization number"],
    ["externalReference", "External reference"],
    ["website", "Website"],
    ["phone", "Phone"],
    ["industry", "Industry"],
    ["size", "Size"],
    ["lifecycleStatus", "Lifecycle"],
    ["tags", "Tags (; separated)"],
    ["description", "Description"],
  ],
  contacts: [
    ["firstName", "First name *"],
    ["lastName", "Last name *"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["jobTitle", "Job title"],
    ["status", "Status"],
    ["tags", "Tags (; separated)"],
    ["communicationPreference", "Communication preference"],
    ["companyOrganizationNumber", "Company organization number"],
  ],
} satisfies Record<Resource, Array<[string, string]>>;

function headerRow(csv: string) {
  const row: string[] = [];
  let field = "",
    quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") break;
    else field += char;
  }
  row.push(field.trim());
  return row;
}
const automaticMapping = (resource: Resource, headers: string[]) =>
  Object.fromEntries(
    fields[resource].flatMap(([field]) => {
      const normalized = field.toLowerCase().replaceAll(/[^a-z]/gu, "");
      const header = headers.find(
        (candidate) =>
          candidate.toLowerCase().replaceAll(/[^a-z]/gu, "") === normalized,
      );
      return header ? [[field, header]] : [];
    }),
  );

export function ImportsPage({ role }: { role: UserRole }) {
  const [resource, setResource] = useState<Resource>("companies");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState<{
    committed: number;
    invalid: number;
  } | null>(null);
  const mutable = role !== "viewer";
  const mappedHeaders = useMemo(
    () => new Set(Object.values(mapping)),
    [mapping],
  );
  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setPreview(null);
    setCommitted(null);
    if (file.size > 512 * 1024) {
      setError("CSV files must be 512 KB or smaller.");
      return;
    }
    const text = await file.text();
    const nextHeaders = headerRow(text);
    setCsv(text);
    setFileName(file.name);
    setHeaders(nextHeaders);
    setMapping(automaticMapping(resource, nextHeaders));
  };
  const switchResource = (next: Resource) => {
    setResource(next);
    setMapping(automaticMapping(next, headers));
    setPreview(null);
    setCommitted(null);
  };
  const request = async (path: string, options?: RequestInit) => {
    const response = await fetch(path, options);
    const payload = (await response.json()) as { error?: { message: string } };
    if (!response.ok)
      throw new Error(
        payload.error?.message ?? "The request could not be completed.",
      );
    return payload;
  };
  const createPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const result = (await request("/api/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, csv, mapping }),
      })) as Preview;
      setPreview(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = (await request(`/api/imports/${preview.importId}/commit`, {
        method: "POST",
      })) as { summary: { committed: number; invalid: number } };
      setCommitted(result.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Data movement"
        title="Imports & exports"
        description="Map, validate, and explicitly commit company or contact CSV files."
      />
      <section className="ns-import-panel" aria-labelledby="import-heading">
        <h2 id="import-heading">Import CSV</h2>
        {!mutable ? (
          <OperationalState
            kind="forbidden"
            message="Viewers can export authorized data but cannot import records."
          />
        ) : (
          <>
            <div className="ns-import-grid">
              <label className="ns-field">
                <span>Record type</span>
                <Select
                  value={resource}
                  onChange={(event) =>
                    switchResource(event.target.value as Resource)
                  }
                >
                  <option value="companies">Companies</option>
                  <option value="contacts">Contacts</option>
                </Select>
              </label>
              <label className="ns-field">
                <span>UTF-8 CSV file</span>
                <input
                  className="ns-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void chooseFile(event)}
                />
              </label>
            </div>
            {fileName && (
              <p className="ns-import-file">
                <strong>{fileName}</strong> · {headers.length} columns detected
              </p>
            )}
            {headers.length > 0 && (
              <fieldset className="ns-mapping">
                <legend>Column mapping</legend>
                <p>
                  Required fields are marked with an asterisk. Each source
                  column can be used once.
                </p>
                <div className="ns-import-grid">
                  {fields[resource].map(([field, label]) => (
                    <label className="ns-field" key={field}>
                      <span>{label}</span>
                      <Select
                        value={mapping[field] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Do not import</option>
                        {headers.map((header) => (
                          <option
                            key={header}
                            value={header}
                            disabled={
                              mappedHeaders.has(header) &&
                              mapping[field] !== header
                            }
                          >
                            {header}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="ns-import-actions">
              <Button
                disabled={!csv || busy}
                onClick={() => void createPreview()}
              >
                {busy ? "Validating…" : "Preview and validate"}
              </Button>
            </div>
            {error && (
              <div className="ns-inline-error" role="alert">
                {error}
              </div>
            )}
            {preview && (
              <section
                className="ns-import-preview"
                aria-labelledby="preview-heading"
              >
                <h3 id="preview-heading">Preview</h3>
                <div className="ns-import-summary">
                  <StatusBadge tone="neutral">
                    {preview.summary.total} rows
                  </StatusBadge>
                  <StatusBadge tone="positive">
                    {preview.summary.valid} valid
                  </StatusBadge>
                  <StatusBadge tone="warning">
                    {preview.summary.warnings} warnings
                  </StatusBadge>
                  <StatusBadge tone="danger">
                    {preview.summary.invalid} invalid
                  </StatusBadge>
                </div>
                <p>{preview.summary.commitPolicy}</p>
                <div
                  className="ns-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Import preview, scrollable"
                >
                  <table className="ns-table">
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Status</th>
                        <th scope="col">Normalized values</th>
                        <th scope="col">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>
                            <StatusBadge
                              tone={
                                row.status === "valid"
                                  ? "positive"
                                  : row.status === "warning"
                                    ? "warning"
                                    : "danger"
                              }
                            >
                              {row.status}
                            </StatusBadge>
                          </td>
                          <td>
                            {Object.entries(row.normalized)
                              .filter(
                                ([, value]) => value !== null && value !== "",
                              )
                              .slice(0, 4)
                              .map(([key, value]) => (
                                <span className="ns-preview-value" key={key}>
                                  <strong>{key}:</strong>{" "}
                                  {Array.isArray(value)
                                    ? value.join(", ")
                                    : String(value)}
                                </span>
                              ))}
                          </td>
                          <td>
                            {[...row.errors, ...row.warnings].join(" ") ||
                              "Ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ns-import-actions">
                  <Button
                    disabled={
                      busy ||
                      preview.summary.valid + preview.summary.warnings === 0
                    }
                    onClick={() => void commit()}
                  >
                    {busy
                      ? "Committing…"
                      : `Commit ${preview.summary.valid + preview.summary.warnings} rows`}
                  </Button>
                </div>
              </section>
            )}
            {committed && (
              <div className="ns-inline-success" role="status">
                <strong>Import complete.</strong> {committed.committed} rows
                committed; {committed.invalid} invalid rows were not changed.
              </div>
            )}
          </>
        )}
      </section>
      <section className="ns-import-panel" aria-labelledby="export-heading">
        <h2 id="export-heading">Export CSV</h2>
        <p>
          Exports contain only active records from this organization. Current
          filters can be supplied in the export URL.
        </p>
        <div className="ns-page-actions">
          <a
            className="ns-button ns-button-secondary"
            href="/api/imports/export/companies.csv"
            download
          >
            Export companies
          </a>
          <a
            className="ns-button ns-button-secondary"
            href="/api/imports/export/contacts.csv"
            download
          >
            Export contacts
          </a>
        </div>
      </section>
    </>
  );
}
