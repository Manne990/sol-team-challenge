# Testing Northstar CRM

`npm run ci` is the clean, root-level feedback loop. It runs static checks,
unit and integration tests, a production build, and browser-backed critical
paths. CI rejects focused, skipped, todo, and empty test inventories.

Tests use a fixed UTC clock (`2026-02-16T12:00:00Z`) and deterministic fixtures
from `tests/fixtures/product-fixtures.mjs`. The fixture set includes both
organizations, owner/member/viewer roles, duplicate names, old and recent
activities, four pipeline stages, overdue/today/upcoming work, and enough
companies to cross a 25-row pagination boundary. Do not make a test depend on
the developer database or the current wall clock.

## Reproducing failures

- `npm run test:unit` runs the fast fixture and domain suite.
- `npm run test:integration` runs persistence and HTTP boundary tests.
- `npm run test:browser` launches a built application on an OS-assigned port
  with a fresh temporary SQLite database, then runs Playwright.
- Add `-- --grep "part of test name"` to the relevant command locally. Never
  commit `.only`, `.skip`, `fixme`, or `todo`; the policy check fails them.
- Use `PWDEBUG=1 npm run test:browser` for Playwright Inspector, or
  `npm run test:browser -- --trace on` to retain a trace.

The browser orchestrator reports its temporary directory and port. On normal
completion and SIGINT/SIGTERM it stops the child server and removes the
temporary database. A failed test retains Playwright's trace/report artifacts,
but never mutates the normal development database.

Authorization tests must assert two facts: the response does not disclose the
foreign identifier, and a before/after snapshot proves that the foreign
organization's persisted rows did not change. `tests/support/isolation.mjs`
contains the shared assertion; checking only an HTTP status is insufficient.
