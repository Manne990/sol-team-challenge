# CSV data movement

Imports are a persisted two-step workflow. Owners and members select companies
or contacts, upload a UTF-8 CSV of at most 512 KB, and explicitly map unique
source headers to supported fields. Files are limited to 2,000 data rows and 50
columns. Quoted commas, escaped quotes, and embedded newlines are supported.

Preview normalizes values and reports every input row as valid, warning, or
invalid. Company name and contact first/last name mappings are required.
Duplicate names and contact emails are explained as warnings and never merged.
Company organization-number and external-reference conflicts are invalid because
those values must remain unique. A related contact company is resolved only by
an active company organization number in the signed-in organization.

Commit is explicit and transactional. Valid rows and rows with acknowledged
warnings are committed; invalid rows remain stored with their errors and do not
silently disappear. A conflict discovered after preview rolls back the complete
commit so the user can preview again. Repeating preview or commit is idempotent
and does not create additional records. Audit summaries contain counts and the
resource type, never complete CSV rows.

Company and contact exports are available to every authenticated role. They
always scope by the active organization before applying list filters, exclude
archived records, use stable columns and ordering, and apply RFC-style CSV
escaping. Values that could be interpreted as spreadsheet formulas are prefixed
with an apostrophe in the exported file. No foreign identifiers, rows, or counts
are included.
