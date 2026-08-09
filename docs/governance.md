# Organization governance and audit

Only owners may manage active membership, organization settings, or audit
history. Owners may add local members, change roles, and revoke access. Removing
or demoting the last active owner is rejected transactionally. Self-revocation
is allowed only when another owner remains; it revokes every active session for
that membership immediately while retaining historical attribution.

Organization name, reporting currency, IANA display timezone, and stale-account
days are validated on the server and saved with optimistic concurrency. Settings
changes append an audit event in the same transaction.

Audit events are append-only at the database layer. Each event has organization,
actor membership where available, action, entity type/reference, correlation ID,
UTC timestamp, and a bounded safe summary. The owner list scopes by organization
before action, entity, actor, date, or pagination filters. There are no product
routes for editing or deleting audit rows.

Authentication, membership, imports, merges, settings, and material CRM writes
append events. Passwords, credentials, session/token values, CSV payloads, and
complete rows are neither written to summaries nor returned by the audit API;
the query layer recursively redacts sensitive keys as defense in depth. Sign-in
errors remain generic and are not logged with submitted credentials.
