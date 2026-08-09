# Notification policy

Notifications are generated from durable task and deal facts. Generation also
runs when the inbox is listed and can be replayed explicitly. A database unique
key makes every rule replay-safe:

- one assignment notification for each task and assignee relationship;
- one approaching notification for an open task from its due time through the
  preceding 24-hour UTC window;
- one overdue notification for each open task and due timestamp;
- one assignment notification for each deal and owner relationship; and
- one important-change notification for each durable deal-stage history event.

Stage events go to the deal owner when that event is first generated. Later
reassignment does not replay old stage history into the new owner's inbox.

Reassignment creates notifications for the new recipient without moving or
exposing the former recipient's read state. Completing or archiving a task stops
new due notifications. Existing notifications remain as history when a related
record is archived, and links continue through the authorized record route.

Notification rows are organization-scoped and recipient-scoped before filters
or pagination. Users may list all or unread notifications, filter by type, mark
one or all read, and follow the related task or deal. Read state belongs only to
the recipient. Replaying generation, including after restart or at an exact
24-hour boundary, cannot duplicate a notification for the same policy window.
