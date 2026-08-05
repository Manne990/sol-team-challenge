# Northstar CRM Challenge

Build the CRM described in [`docs/product-contract.md`](docs/product-contract.md).
The GitHub issue queue is the authoritative work breakdown.

This repository begins from a deliberately minimal, green baseline. The
baseline scripts prove only that the challenge repository is installable; they
are not product implementation or product acceptance.

## Required Final Commands

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

The complete product must run locally without paid services or private secrets.
Reality, CI, and external acceptance determine completion.

## Local development

Node.js 22 or newer is required. From a clean checkout:

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open <http://127.0.0.1:4173>. Use `NORTHSTAR_DB_PATH` to keep the durable SQLite
file elsewhere; its parent directory is created at startup. `NORTHSTAR_HOST`
and `NORTHSTAR_PORT` provide environment-based defaults, while explicit CLI
arguments win. Invalid configuration fails before the server listens.

`npm run build` creates the production client and server in `dist`; run it with
`npm start`. See [`docs/architecture.md`](docs/architecture.md) for boundaries,
configuration, and feature extension points.

## Seed accounts

| Organization   | Email                      | Password           | Role   |
| -------------- | -------------------------- | ------------------ | ------ |
| Northstar Demo | `owner@northstar.test`     | `OwnerPass!2026`   | owner  |
| Northstar Demo | `member@northstar.test`    | `MemberPass!2026`  | member |
| Northstar Demo | `viewer@northstar.test`    | `ViewerPass!2026`  | viewer |
| Outside Demo   | `other-owner@outside.test` | `OutsidePass!2026` | owner  |

Seed is deterministic and idempotent. See [`docs/release.md`](docs/release.md)
for the route/role inventory, limitations, backup and recovery steps, and exact
release verification procedure.
