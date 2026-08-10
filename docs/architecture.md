# Architecture and local operation

Northstar is one TypeScript repository with three explicit boundaries:

- `src/client` is the React browser application. It communicates only through `/api`.
- `src/server` owns HTTP, runtime configuration, persistence access, authentication, and authorization.
- `src/shared` contains transport types only; it must not contain secrets or server behavior.

Development runs Express with Vite middleware. Production compiles the server to `dist/server` and serves the Vite output in `dist/client` from the same process. SQLite is the only durable dependency. `NORTHSTAR_DB_PATH` defaults to `data/northstar.sqlite`; its parent must be writable and its extension must identify SQLite. CLI `--host`, `--port`, and `--database` override environment values.

## Commands

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
NODE_ENV=production npm start -- --host 127.0.0.1 --port 4173
```

`db:reset` removes only the configured database and creates a fresh migration ledger. `db:seed` is replay-safe. Local databases, environment files, build output, coverage, and logs are ignored. Copy `.env.example` for optional local configuration; no secrets are required or committed.

## Seed accounts

The deterministic seed can be replayed without creating duplicates. It creates
the following isolated local identities:

| Organization   | Email                      | Password           | Role   |
| -------------- | -------------------------- | ------------------ | ------ |
| Northstar Demo | `owner@northstar.test`     | `OwnerPass!2026`   | owner  |
| Northstar Demo | `member@northstar.test`    | `MemberPass!2026`  | member |
| Northstar Demo | `viewer@northstar.test`    | `ViewerPass!2026`  | viewer |
| Outside Demo   | `other-owner@outside.test` | `OutsidePass!2026` | owner  |

## Recovery and operational limitations

Stop the server with `Ctrl-C` so SQLite closes cleanly. Committed data survives
a restart because the configured database, its WAL, and its shared-memory file
are durable local files. To recover from a failed local start:

1. Confirm that the configured database directory is writable and that the
   filename ends in `.db`, `.sqlite`, or `.sqlite3`.
2. Stop every Northstar process using that database, then run
   `NORTHSTAR_DB_PATH=/absolute/path/crm.sqlite npm run db:seed` to apply any
   missing forward migrations and restore deterministic fixture rows.
3. If the local data may be discarded, run `db:reset` followed by `db:seed`
   with the same explicit path. `db:reset` is destructive only to that selected
   database.
4. Re-run `npm run ci` before launching again. Browser traces for failures are
   retained under `test-results/`.

Northstar V1 is a single-process local deployment: it has no hosted backup,
multi-node coordination, email delivery, or external identity provider. Back
up a stopped database by copying the database together with any `-wal` and
`-shm` siblings. Times are stored in UTC and displayed with an explicit UTC
label. The release is verified with the maintained Node version declared in
`package.json` and Playwright's bundled Chromium.

Expected API failures use a stable `{ error: { code, message, requestId } }` envelope. Unexpected server errors are logged with the request ID and return a generic message. The client deliberately renders connecting, unavailable, and unexpected-interface states. Future domain modules should add route, service, repository, and migration layers behind the server boundary while retaining organization scope at every repository query.
