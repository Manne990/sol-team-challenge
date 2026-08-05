# Release operations and evidence

## Clean candidate verification

Run from a clean checkout with Node.js 22 or newer:

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

The CI command includes formatting, lint, TypeScript, static and test-policy
checks, isolated unit/integration/database suites, a production build, and the
real browser application on a unique port and temporary SQLite file. Browser
coverage includes authentication, company/contact/activity/deal/task workflows,
search and saved views, dashboard reconciliation, CSV movement, merges,
notifications, governance/audit, responsiveness, accessibility, conflict and
failure recovery. No paid service, cloud database, or private secret is used.

## Public routes and authorization

| Surface              | Anonymous             | Viewer                    | Member                                | Owner                | Outside organization    |
| -------------------- | --------------------- | ------------------------- | ------------------------------------- | -------------------- | ----------------------- |
| Sign-in/session      | Sign in only          | Own session               | Own session                           | Own session          | Own isolated session    |
| Dashboard            | Redirected to sign-in | Read metrics/links        | Read                                  | Read                 | Own metrics only        |
| Companies/contacts   | Denied                | Read/export               | Create/edit/archive/import/merge      | Same                 | Own records/counts only |
| Activities           | Denied                | Read                      | Create/edit policy and follow-up      | Same                 | Own timeline only       |
| Deals/pipeline       | Denied                | Read                      | Create/edit/transition                | Configure stages too | Own pipeline only       |
| Tasks                | Denied                | Read                      | Create/assign/complete/reopen/archive | Same                 | Own tasks only          |
| Search/saved views   | Denied                | Search and personal views | Same                                  | Same                 | Own matches/counts only |
| Notifications        | Denied                | Own read state            | Own read state                        | Own read state       | Own notifications only  |
| Imports/exports      | Denied                | Export                    | Preview/commit/export                 | Same                 | Own rows only           |
| Duplicate review     | Denied                | Read suggestions          | Explicit merge                        | Same                 | Own candidates only     |
| Audit/administration | Denied                | Denied                    | Denied                                | Organization-scoped  | Own organization only   |

API roots are `/api/auth`, `/api/dashboard`, `/api/companies`, `/api/contacts`,
`/api/activities`, `/api/deals`, `/api/tasks`, `/api/search`, `/api/views`,
`/api/notifications`, `/api/imports`, `/api/duplicates`, and `/api/governance`.
`/api/health` is the only anonymous operational endpoint. Foreign identifiers
resolve as unavailable and never contribute data, snippets, counts, exports,
audit events, or mutations.

## Database backup and recovery

The default durable database is `data/northstar.sqlite`. For a consistent live
backup, stop Northstar and copy the database plus any `-wal` and `-shm` files,
or use SQLite's online backup command. Preserve file permissions. To recover:

1. Stop the process and retain the damaged files for diagnosis.
2. Set `NORTHSTAR_DB_PATH` to the restored copy.
3. Run `PRAGMA integrity_check` with SQLite, then `npm run db:seed`; seed applies
   pending migrations and safely replays deterministic fixtures.
4. Start Northstar and verify `/api/health`, sign-in, and a persisted record.

`npm run db:reset` is destructive and intended for a fresh development or test
database only. It deletes the configured database before applying migrations.
Normal startup and `db:seed` do not delete committed state. SQLite transactions,
foreign keys, WAL mode, optimistic versions, and immutable audit triggers protect
against interrupted writes and silent last-write data loss.

## Deliberate V1 limitations

- Northstar is a single-node local deployment; it has no hosted replication or
  multi-region failover.
- Membership creation is local administration rather than email invitation.
- Notifications are in-app and generated deterministically when queried; there
  is no email, SMS, or background worker.
- CSV import is UTF-8, limited to 1 MB and 1,000 data rows per preview. Warning
  rows require correction and a new preview; they never merge automatically.
- Money retains each deal's currency. Cross-currency values are not converted.
- Organization locale/timezone settings are stored, while operational due-state
  boundaries remain explicitly UTC in V1.
