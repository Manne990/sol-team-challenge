# Deals and pipeline semantics

Amounts are integer minor units paired with an uppercase three-letter currency. Aggregates remain separated by currency; Northstar never invents exchange rates. Probability is an integer from 0–100, and expected close dates are calendar dates (`YYYY-MM-DD`).

Every query scopes the authenticated organization before filters, pagination, or totals. A deal's company, contacts, owner, and stage must belong to that organization; contacts must also belong to the selected company. Owners and members mutate deals, viewers read them, and only owners configure stages.

Stages have stable identifiers, unique ordering, an active lifecycle, and an open/won/lost outcome. Owners may add, reorder, rename, recolor, activate, or deactivate them. Deactivation prevents new transitions while preserving deals and history already attached to the stage.

Stage changes use a dedicated transaction and optimistic version. The transaction updates stage, status, loss reason, version, stage history, and audit evidence together. Lost requires a reason; won rejects one. Moving a won/lost deal back to an open stage explicitly reopens it and clears the old loss reason. General edits cannot silently change stage.

The list and keyboard-accessible pipeline board use the same filter result and currency totals. The board provides a non-drag “Move with stage menu” route. Archive removes a deal from active views without deleting contacts, transitions, or audit history.
