# Authentication and authorization

Northstar stores only a SHA-256 digest of each cryptographically random 256-bit
session token. A session is bound to one user, membership, and organization and
expires after eight hours by default. Logout, role changes, and membership
revocation invalidate persisted sessions immediately.

Passwords use bcrypt with cost 12. Sign-in performs a bcrypt comparison even
when the account does not exist and always returns the same user-facing error
for an unknown email, wrong password, disabled account, or inaccessible
organization.

All request handlers must authenticate first and use the returned `Principal`
as the sole source of user, role, and organization identity. Repository queries
must include `principal.organizationId` before filters, aggregation, pagination,
or mutation. Client-supplied organization or ownership fields are never an
authorization source. Foreign identifiers use the same not-found response as
missing identifiers.

Owners manage membership. Members may mutate CRM records. Viewers are read-only.
Changing a role or revoking membership invalidates every session for that
membership. The final active owner cannot be demoted or revoked.
