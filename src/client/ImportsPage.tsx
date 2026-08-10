import { useMemo, useState, type FormEvent } from "react";
import { OperationalState } from "./components";

type Kind = "companies" | "contacts";
type Preview = {
  id: string;
  kind: Kind;
  status: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  committedAt: string | null;
  rows: Array<{
    row: number;
    values: Record<string, unknown>;
    errors: string[];
    warnings: string[];
  }>;
};
const fields: Record<Kind, string[]> = {
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
    "ownerId",
    "tags",
    "description",
  ],
  contacts: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "jobTitle",
    "ownerId",
    "status",
    "tags",
    "communicationPreference",
    "companyId",
  ],
};
const sourceHeaders = (source: string) =>
  source
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)[0]
    ?.split(",")
    .map((value) => value.trim().replace(/^"|"$/gu, "")) ?? [];
const identityMapping = (source: string, kind: Kind) =>
  Object.fromEntries(
    sourceHeaders(source)
      .filter((header) => fields[kind].includes(header))
      .map((header) => [header, header]),
  );

export function ImportsPage({ role }: { role: "owner" | "member" | "viewer" }) {
  const [kind, setKind] = useState<Kind>("companies"),
    [csv, setCsv] = useState(""),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const headers = useMemo(() => sourceHeaders(csv), [csv]);
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const source = await file.text();
    setCsv(source);
    setMapping(identityMapping(source, kind));
    setPreview(null);
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/imports/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, csv, mapping }),
      });
      const body = (await response.json()) as
        Preview | { error: { message: string } };
      if (!response.ok) {
        setError("error" in body ? body.error.message : "Preview failed.");
        return;
      }
      setPreview(body as Preview);
    } catch {
      setError("The import service is unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/imports/${preview.id}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as
        Preview | { error: { message: string } };
      if (!response.ok) {
        setError("error" in body ? body.error.message : "Commit failed.");
        return;
      }
      setPreview(body as Preview);
    } catch {
      setError("The import could not be committed. No rows were changed.");
    } finally {
      setBusy(false);
    }
  }
  if (role === "viewer")
    return (
      <OperationalState
        kind="forbidden"
        title="Imports are read-only"
        message="Ask an owner or member to import CRM records."
      />
    );
  return (
    <section aria-labelledby="imports-title">
      <header className="ns-page-header">
        <div>
          <p className="ns-eyebrow">Data quality</p>
          <h1 id="imports-title">Imports and exports</h1>
          <p>
            Map and validate every CSV row before making an explicit commit.
          </p>
        </div>
        <div className="ns-page-actions">
          <a
            className="ns-button ns-button--secondary"
            href="/api/imports/exports/companies.csv"
          >
            Export companies
          </a>
          <a
            className="ns-button ns-button--secondary"
            href="/api/imports/exports/contacts.csv"
          >
            Export contacts
          </a>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form className="ns-import-form" onSubmit={submit} aria-busy={busy}>
        <label className="ns-field">
          <span>Record type</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as Kind);
              setMapping(identityMapping(csv, event.target.value as Kind));
              setPreview(null);
            }}
          >
            <option value="companies">Companies</option>
            <option value="contacts">Contacts</option>
          </select>
        </label>
        <label className="ns-field">
          <span>UTF-8 CSV file (maximum 512 KB)</span>
          <input
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
        </label>
        {csv && (
          <fieldset>
            <legend>Column mapping</legend>
            <p>
              Choose the source header for each supported field. Required fields
              are marked.
            </p>
            <div className="ns-mapping-grid">
              {fields[kind].map((target) => (
                <label className="ns-field" key={target}>
                  <span>
                    {target}
                    {["name", "firstName", "lastName"].includes(target)
                      ? " *"
                      : ""}
                  </span>
                  <select
                    value={
                      mapping[target] ??
                      (headers.includes(target) ? target : "")
                    }
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [target]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Not imported</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <button className="ns-button" type="submit" disabled={busy || !csv}>
          {busy ? "Validating…" : "Preview and validate"}
        </button>
      </form>
      {preview && (
        <section className="ns-import-preview" aria-labelledby="preview-title">
          <h2 id="preview-title">Preview</h2>
          <p role="status">
            {preview.validCount} valid · {preview.errorCount} with errors ·{" "}
            {preview.rowCount} total
          </p>
          <div
            className="ns-table-scroll"
            role="region"
            aria-label="CSV row validation results"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Values</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>
                      {Object.values(row.values)
                        .filter((value) => value !== null && value !== "")
                        .map((value) =>
                          Array.isArray(value)
                            ? value.join("; ")
                            : String(value),
                        )
                        .join(" · ")}
                    </td>
                    <td>
                      {row.errors.length ? (
                        <ul className="ns-row-errors">
                          {row.errors.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <strong>Valid</strong>
                      )}
                      {row.warnings.length > 0 && (
                        <ul className="ns-row-warnings">
                          {row.warnings.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Commit semantics: valid rows are inserted together in one
            transaction; rows with errors are retained in this report and
            skipped.
          </p>
          <button
            className="ns-button"
            type="button"
            disabled={
              busy || preview.validCount === 0 || preview.status === "committed"
            }
            onClick={() => void commit()}
          >
            {preview.status === "committed"
              ? "Import committed"
              : busy
                ? "Committing…"
                : `Commit ${preview.validCount} valid row${preview.validCount === 1 ? "" : "s"}`}
          </button>
        </section>
      )}
    </section>
  );
}
