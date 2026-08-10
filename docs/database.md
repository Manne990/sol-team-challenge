# Database lifecycle

Northstar uses SQLite with foreign keys, WAL journaling, a five-second busy timeout, UTC ISO-8601 timestamps, integer minor currency units, and integer optimistic-lock versions. `NORTHSTAR_DB_PATH` selects the database; the default is the ignored `data/northstar.sqlite`.

`npm run db:reset` removes only that configured database and applies every committed migration in filename order. `npm run db:seed` migrates if necessary and idempotently creates the four frozen accounts plus two isolated organizations, 32 CRM account histories, pipeline stages, deals, and overdue/upcoming/completed work. Seed password values are stored as deterministic scrypt hashes for the authentication layer to verify.

Tests use unique temporary directories and never touch developer state:

```bash
npm run db:test
NORTHSTAR_DB_PATH=/tmp/northstar-check.sqlite npm run db:reset
NORTHSTAR_DB_PATH=/tmp/northstar-check.sqlite npm run db:seed
```

Migrations are forward-only and transactionally recorded in `schema_migrations`. Add a numbered SQL file rather than editing a migration after release.
