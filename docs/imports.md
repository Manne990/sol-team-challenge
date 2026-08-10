# CSV import and export

Northstar accepts UTF-8 company and contact CSV files up to 512 KB, 1,000 data
rows, and 50 uniquely named columns. The browser exposes explicit source-header
mapping for every supported field. Quoted fields, embedded commas, escaped
quotes, CRLF, and embedded newlines are parsed according to CSV conventions.

Preview is durable and non-mutating. Every source row remains visible with its
normalized values, errors, and explainable duplicate warnings. Required-field,
email, enum, relationship, formula-prefix, and uniqueness failures make only
that row ineligible. Commit inserts all eligible rows in one transaction and
skips the reported invalid rows; if any eligible insert fails, the transaction
rolls back and the preview remains available. The audit event records counts
and kind, never complete source rows.

An idempotency key cannot be reused for different content. Replaying the same
content or commit returns the original import and never inserts more records.
Import previews and commits are organization-scoped; viewers cannot mutate.

Company and contact exports apply the supplied active list filters inside the
authenticated organization before ordering. Columns are stable, CSV quoting is
RFC-compatible, and values beginning with spreadsheet formula characters are
prefixed with an apostrophe. Archived rows are excluded unless
`archived=true` is explicitly requested.
