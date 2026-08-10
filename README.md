# Northstar CRM Challenge

Build the CRM described in [`docs/product-contract.md`](docs/product-contract.md).
The GitHub issue queue is the authoritative work breakdown.

Runtime architecture, configuration, database lifecycle, and recovery commands are documented in [`docs/architecture.md`](docs/architecture.md). No external service or secret is required.

CSV preview, partial-row commit, replay, and filtered export behavior is documented in [`docs/imports.md`](docs/imports.md).

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
