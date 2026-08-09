# Architecture

Northstar is one Node.js process: Express owns `/api/*` and serves a Vite-built
React single-page application. Development uses Vite middleware in the same
process, so the required `npm run dev -- --host … --port …` command always
starts the complete product without coordinating ports.

## Boundaries

- `src` contains React screens, reusable UI, and browser-only code.
- `src/server` contains HTTP, configuration, authorization, persistence, and
  integration code.
- `src/shared` contains transport-safe types shared by browser and server.
- `scripts` contains database and operational lifecycle commands.

Feature code should depend inward: routes call services/repositories; database
details do not enter React components. API errors use stable codes, corrective
messages, and request IDs. Unexpected details are logged server-side only.

## Task time policy

Task due times are accepted and stored as ISO-8601 UTC timestamps. The task UI
labels due values as UTC, and the server derives overdue, due-today, and
upcoming views against UTC day boundaries from one request-time clock. Tasks
without a due time remain open work but never appear in a time-bounded view.
Completion and reopening set or clear `completed_at`; archiving is independent
and preserves both the task's relationship history and completion state.

## Runtime configuration

| Setting     | CLI      | Environment         | Default                 |
| ----------- | -------- | ------------------- | ----------------------- |
| Listen host | `--host` | `NORTHSTAR_HOST`    | `127.0.0.1`             |
| Listen port | `--port` | `NORTHSTAR_PORT`    | `4173`                  |
| SQLite file | —        | `NORTHSTAR_DB_PATH` | `data/northstar.sqlite` |

CLI host and port take precedence over environment values. Invalid values stop
startup with a corrective error. Database files, environment files, build
outputs, logs, and test artifacts are ignored by Git.

## Extension points

The database lifecycle scripts are intentionally stable root entry points for
forward migrations and deterministic seed logic. Authentication middleware can
be added before domain routes. Each domain should expose an organization-scoped
repository and service rather than accepting organization identifiers from the
browser as authority.
