# Release verification

This checklist verifies the integrated Northstar CRM candidate; it is not an
acceptance declaration. External acceptance must name the exact merged `main`
commit.

## Independent clean-checkout procedure

Run the following from two independently created, clean checkouts of the same
candidate commit. Use a different absolute database path and port in each
checkout:

```bash
git checkout --detach <candidate-commit>
npm ci
NORTHSTAR_DB_PATH=/tmp/northstar-release-a.sqlite npm run db:reset
NORTHSTAR_DB_PATH=/tmp/northstar-release-a.sqlite npm run db:seed
NORTHSTAR_DB_PATH=/tmp/northstar-release-a.sqlite npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173 \
  --database /tmp/northstar-release-a.sqlite
```

Open `http://127.0.0.1:4173/workspace`, sign in with each seed identity, and
review the matrix below. Confirm `GET /api/health` returns `status: "ok"`, stop
the process with `Ctrl-C`, launch again with the same command, and confirm the
health endpoint, sign-in, and seeded records remain available. The second
checkout uses a different port and database so no process, dependency tree, or
persisted state is shared.

`npm run ci` checks formatting, lint, both TypeScript configurations, test
policy, database tests, authentication tests, the complete Vitest inventory,
the Chromium inventory, and a production build. `npm run test:policy` rejects
focused, skipped, todo, fixme, or empty inventories; Playwright also sets
`forbidOnly` and runs browser files fully in parallel to expose order coupling.
Database and integration helpers allocate isolated temporary databases, while
browser orchestration derives a checkout-specific port and refuses to reuse a
running server.

## Route and authorization review

| Route or surface                | Anonymous                       | Owner                                   | Member                     | Viewer                              | Outside organization                                       |
| ------------------------------- | ------------------------------- | --------------------------------------- | -------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `/workspace` dashboard          | Sign-in only                    | Read metrics and linked filters         | Read                       | Read                                | Only Outside Demo metrics                                  |
| `/companies` and detail         | Sign-in only                    | Read/write/archive/restore              | Read/write/archive/restore | Read; mutations absent or forbidden | Only Outside Demo records and counts                       |
| `/contacts` and detail          | Sign-in only                    | Read/write/archive/restore              | Read/write/archive/restore | Read only                           | Only Outside Demo records and relations                    |
| `/activities`                   | Sign-in only                    | Read and record                         | Read and record            | Read only                           | Only Outside Demo timeline                                 |
| `/deals` pipeline and list      | Sign-in only                    | Read/write/transition/configure stages  | Read/write/transition      | Read only                           | Only Outside Demo values and history                       |
| `/tasks`                        | Sign-in only                    | Read/write/assign/complete              | Read/write/assign/complete | Read only                           | Only Outside Demo work                                     |
| `/notifications`                | Sign-in only                    | Personal list/read state                | Personal list/read state   | Personal list/read state            | Only the outside user's notifications                      |
| `/imports` and filtered exports | Sign-in only                    | Preview/commit/export                   | Preview/commit/export      | No mutation; authorized reads only  | Import, export, and duplicate checks remain outside-scoped |
| `/audit`                        | Sign-in only                    | Read append-only organization audit     | Hidden and forbidden       | Hidden and forbidden                | Only Outside Demo audit                                    |
| `/admin`                        | Sign-in only                    | Manage settings and memberships         | Hidden and forbidden       | Hidden and forbidden                | Manages only Outside Demo                                  |
| Global search and saved views   | Sign-in only                    | Organization results and personal views | Same                       | Same without record mutation        | No Northstar Demo matches, snippets, or counts             |
| Missing/foreign identifiers     | Generic authentication boundary | Not-found equivalent                    | Not-found equivalent       | Not-found equivalent                | Cannot distinguish or mutate Northstar identifiers         |

The browser inventory visits the complete navigation at desktop, tablet, and
mobile widths, runs automated accessibility analysis, checks overflow and
runtime-console failures, exercises keyboard sign-in/navigation/dialogs, and
verifies conflict and retry recovery. Server and repository inventories cover
role denial, foreign-state immutability, restart durability, transaction
rollback, replay safety, validation, not-found, and stable error envelopes.

## Evidence record

For the release PR, record both clean-checkout commit hashes, commands, suite
counts, restart results, required-check URL, merged `main` hash, and issue
closure. The completion request must use the merged `main` hash—not the branch
or pre-merge hash—and must state that only the external referee can accept it.
