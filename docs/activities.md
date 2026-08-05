# Activity history policy

Activities are append-oriented history. Calls, emails, meetings, notes, and
status changes retain their creator, occurred time, participant set, related
record identifiers, and safe relation labels permanently. Later renames or
archives therefore do not rewrite the historical account.

The creator or an organization owner may correct only the subject and summary.
Corrections use the visible `version` and return a conflict instead of silently
overwriting a concurrent edit. Viewers can read but cannot record or correct
activity. Activities are never deleted through the product API.

Creating an activity with a follow-up creates both records in one SQLite
transaction. A failed relationship, participant, assignee, activity, task, or
audit write rolls the entire operation back.
