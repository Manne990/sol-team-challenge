# Deals and pipeline

Deals store monetary amounts as integer minor units and currencies as uppercase three-letter codes. Probability is an integer from 0 through 100. Expected close dates are calendar dates (`YYYY-MM-DD`) rather than inferred instants.

Active pipeline stages are organization-scoped and stably ordered by `position`. Owners can rename, reorder, deactivate, and add stages. Deactivation never deletes a stage, so historical deals and transition records remain valid. Members may create and edit deals and use the explicit stage selector; viewers can read the list and visual pipeline but cannot mutate it.

Every stage or outcome change uses `POST /api/deals/:id/transition` with the last observed version. A stale version returns a recoverable conflict. Won deals are set to 100% probability. Lost deals require a reason and become 0%; reopening clears the loss reason while retaining transition history. Creation, edits, transitions, archive, and restore append safe audit events in the same transaction as their domain change.

`GET /api/deals` accepts stage, status, owner, company, currency, and text filters plus pagination. Its `items` and stage-grouped `stages[].deals` derive from the same tenant-scoped query so list and visual views reconcile. Foreign identifiers use not-found responses and are filtered before counts or pagination.
