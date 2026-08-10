# Task time policy

Task timestamps are accepted with an explicit browser offset, normalized to UTC, stored as ISO-8601 text, and rendered in the user's browser timezone. Server views use UTC boundaries: `overdue` means an incomplete task due before the query's `asOf`; `due today` means an incomplete task whose UTC calendar date equals `asOf`; `upcoming` begins at the next UTC midnight. Completed tasks remain durable and relation filters continue to work when linked records are archived.

Updates require the last observed integer `version`. A stale update returns `EDIT_CONFLICT` without overwriting either user's information. Assignment and optional company, contact, and deal relationships are validated in the authenticated organization.
