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

Expected API failures use a stable `{ error: { code, message, requestId } }` envelope. Unexpected server errors are logged with the request ID and return a generic message. The client deliberately renders connecting, unavailable, and unexpected-interface states. Future domain modules should add route, service, repository, and migration layers behind the server boundary while retaining organization scope at every repository query.
