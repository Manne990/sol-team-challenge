# Testing Northstar CRM

Run `npm run ci` from the repository root to reproduce the required static, unit/integration, and Chromium-backed checks. Use `npm run test:unit -- --reporter=verbose` or `npm run test:browser -- --debug` to isolate a failure. Browser traces are retained in `test-results/` after failures.

Tests must import `productFixtures()` for frozen clocks, opaque identifiers, two organizations, every role, pagination volume, duplicate names, historical activity, pipeline stages, and overdue/upcoming work. Each integration test creates its own database with `createIsolatedDatabase()`; never use `data/` or a developer database. Negative tenant tests must assert the generic response and call `expectPersistedStateUnchanged` to prove foreign bytes did not change.

Browser fixtures bind to port `0`, allowing the operating system to allocate a unique port, and close servers in teardown. Playwright owns browser cleanup and retains a trace on failure. CI rejects focused, skipped, pending, or empty test suites before running tests.
