# Governance and audit policy

Administration and audit routes require an authenticated owner. Organization settings accept only name, IANA timezone, locale, and three-letter currency, with optimistic version conflicts. Owners create local members, change roles, and revoke access. The last owner cannot be demoted or revoked; self-revocation is rejected explicitly; revocation ends every active session for that membership in the same transaction.

Material CRM, membership, import, merge, settings, sign-in, and sign-out operations append audit events. Each event contains organization, actor membership when available, action, entity type/id, correlation ID, UTC timestamp, and a bounded safe summary. Audit storage is protected by database update/delete triggers and has no mutation route.

The read boundary scopes organization before filters, counts, ordering, or pagination. Action, entity type/id, actor, and date filters can be combined. As defense in depth, returned summaries recursively omit keys that resemble passwords, credentials, secrets, tokens, sessions, raw content, or complete imported rows and truncate unusually large values. Authentication audit events never store cookie values, session IDs, hashes, passwords, or credentials.
