# Database lifecycle

Northstar uses SQLite through Node's built-in `node:sqlite` module. The default
database is `data/northstar.sqlite`; set `NORTHSTAR_DB_PATH` to an absolute or
working-directory-relative path for an isolated database.

`npm run db:reset` removes the configured database and applies every SQL file in
`migrations/` in lexical order. `npm run db:seed` applies pending migrations and
idempotently creates the four frozen accounts plus two isolated organizations,
30 Northstar companies, 36 contacts, 40 historical activities, 20 deals across
five ordered stages, and 28 past/future/completed tasks.

All timestamps are ISO-8601 UTC text. Money is integer minor units plus a
three-letter currency. Mutable aggregate roots carry an integer `version` for
optimistic concurrency. IDs are opaque text values. Composite foreign keys pair
related IDs with `organization_id`, preventing relations across tenants in the
database rather than relying only on application queries. Write workflows can
use the exported `transaction` helper from `src/db/database.mjs`.

Migrations execute within `BEGIN IMMEDIATE` and are recorded only after success.
Tests create a unique temporary directory and database per case and demonstrate
migration replay, deterministic seed replay, foreign-organization rejection,
transaction rollback, immutable audit history, and persistence after reopen:

```bash
npm run test:db
NORTHSTAR_DB_PATH=/tmp/northstar-manual.sqlite npm run db:reset
NORTHSTAR_DB_PATH=/tmp/northstar-manual.sqlite npm run db:seed
```
