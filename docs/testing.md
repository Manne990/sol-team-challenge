# Testing Northstar CRM

Run `npm run ci` from the repository root to reproduce the required static, unit/integration, and Chromium-backed checks. Use `npm run test:unit -- --reporter=verbose` or `npm run test:browser -- --debug` to isolate a failure. Browser traces are retained in `test-results/` after failures.

Tests must import `productFixtures()` for frozen clocks, opaque identifiers, two organizations, every role, pagination volume, duplicate names, historical activity, pipeline stages, and overdue/upcoming work. Each integration test creates its own database with `createIsolatedDatabase()`; never use `data/` or a developer database. Negative tenant tests must assert the generic response and call `expectPersistedStateUnchanged` to prove foreign bytes did not change.

The default Playwright suite resets and seeds a checkout-specific temporary
SQLite database, launches the real Express/Vite application on a
checkout-derived port, and drives persisted browser journeys through the same
HTTP routes used in production. It covers deal outcome lifecycle, activity
deletion, explicit duplicate merge, and outside-organization identity. The
older `tests/browser/fixture-server.mjs` harness remains useful for isolated UI
development but is not the CI browser target. Playwright owns process and
browser cleanup and retains a trace on failure. CI rejects focused, skipped,
pending, or empty test suites before running tests.
