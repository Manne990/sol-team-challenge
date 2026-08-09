# Release verification

Northstar's release boundary is an exact Git commit, not a working directory or
a closed issue. Run the following from a clean checkout of the candidate:

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

`npm run ci` enforces formatting, lint, client and server type checks, static
and test-policy checks, component/server tests, fixture isolation, migration and
restart tests, a production build, and the Playwright browser inventory. It
rejects focused, skipped, todo, fixme, or empty test inventories. Release
verification repeats this command chain from two independent clean checkouts so
neither generated files nor a developer database can make the result pass.

## Public surface inventory

| Surface                        | Anonymous                  | Owner                        | Member                       | Viewer                       | Outside organization       |
| ------------------------------ | -------------------------- | ---------------------------- | ---------------------------- | ---------------------------- | -------------------------- |
| Sign-in and session            | Generic corrective sign-in | Own session and logout       | Own session and logout       | Own session and logout       | Isolated session           |
| Dashboard `/`                  | Sign-in gate               | Organization evidence        | Organization evidence        | Read-only evidence           | Only outside evidence      |
| Companies `/companies`         | Sign-in gate               | Read/write/archive           | Read/write/archive           | Read only                    | No Northstar facts         |
| Contacts `/contacts`           | Sign-in gate               | Read/write/archive           | Read/write/archive           | Read only                    | No Northstar facts         |
| Activities `/activities`       | Sign-in gate               | Read/write/follow-up         | Read/write/follow-up         | Read only                    | No Northstar facts         |
| Deals `/deals`                 | Sign-in gate               | Read/write/stages            | Read/write                   | Read only                    | No Northstar facts         |
| Tasks `/tasks`                 | Sign-in gate               | Read/write/transitions       | Read/write/transitions       | Read only                    | No Northstar facts         |
| Notifications `/notifications` | Sign-in gate               | Personal inbox/read state    | Personal inbox/read state    | Personal inbox/read state    | Only outside inbox         |
| Imports `/imports`             | Sign-in gate               | Import and filtered export   | Import and filtered export   | Filtered export only         | Only outside rows          |
| Duplicates `/duplicates`       | Sign-in gate               | Review and explicit merge    | Review and explicit merge    | Review only                  | No cross-tenant candidates |
| Audit `/audit`                 | Sign-in gate               | Read safe append-only audit  | Forbidden and hidden         | Forbidden and hidden         | Only outside audit         |
| Administration `/admin`        | Sign-in gate               | Settings and membership      | Forbidden and hidden         | Forbidden and hidden         | Only outside organization  |
| Global search and saved views  | Sign-in gate               | Scoped results/private views | Scoped results/private views | Scoped results/private views | No Northstar matches       |

Identifier guessing is checked at server and persistence boundaries: a foreign
record is not disclosed, foreign counts do not change, and no mutation or audit
side effect is created. Optimistic versions surface concurrent edits as
recoverable conflicts rather than silently replacing another user's changes.

## Database lifecycle and recovery

The default durable file is `data/northstar.sqlite`. Set
`NORTHSTAR_DB_PATH=/absolute/path/northstar.sqlite` to isolate an environment.
Forward migrations run transactionally at startup and during seed. Committed
state survives graceful or abrupt process restart; interrupted transactions
roll back under SQLite's journal guarantees.

Before destructive recovery, stop Northstar and copy the database file and any
`-wal` and `-shm` siblings together. Restarting applies pending forward
migrations. `npm run db:reset` intentionally deletes the configured database
and recreates it, so use it only for disposable local or test data. Seed is
idempotent and may be rerun after migrations.

## V1 limitations

- Northstar is a single-process, local SQLite deployment; horizontal clustering
  and hosted backup scheduling are outside V1.
- Dates and task due times are stored and displayed in UTC. Organization
  timezone is retained for reporting configuration but does not rewrite facts.
- Monetary totals keep currencies separate; there is no exchange-rate service.
- Notifications are in-app only. Email, calendar sync, and background delivery
  while the service is stopped are outside V1.
- Import accepts UTF-8 CSV within the documented row, column, and size limits;
  spreadsheet files and automatic duplicate merging are intentionally excluded.

The external referee, not this document or the application team, determines
whether an exact release commit satisfies the frozen acceptance boundary.
