# Activity timeline policy

Calls, emails, meetings, notes, and status changes share one organization-scoped timeline ordered by `occurred_at DESC, id DESC`. Filters are applied before pagination. Input times are normalized to UTC; the browser labels and displays them in the user's local timezone.

Members and owners may record activities. Viewers are read-only. The original type, creator, occurred time, participants, relationships, and safe display-name snapshots are immutable historical facts. The creator or an organization owner may correct only the subject and narrative using the current version; stale versions return a recoverable conflict.

The creator or an owner may also explicitly delete an activity after a
consequence-bearing confirmation. Deletion is version-checked, removes the
timeline entry and participant edges transactionally, and appends a safe audit
event containing the former subject rather than silently erasing accountability.

Related company, contact, and deal identifiers and every participant must belong to the active organization. Labels are copied only as safe historical snapshots, so later renames or archives do not rewrite history. A requested follow-up task is validated first and created in the same immediate transaction as the activity and audit event; any failure rolls back all three.
