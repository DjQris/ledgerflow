# Phase 3G operations dashboard

Phase 3G replaces the operations overview placeholder with protected, live
operational metrics and adds administrator-only user search, inspection, role
changes, and account suspension/reactivation. It does not add balance editing,
ledger mutation, customer impersonation, or manual job retry controls.

## Authorization and data boundaries

`OPERATIONS` and `ADMIN` may read `/operations/metrics`. Only `ADMIN` may list,
search, inspect, or change user accounts under `/admin/users` and the web
`/api/operations/users` routes. User responses are allowlisted to ID, email,
role, status, and creation time; password hashes, credentials, sessions,
refresh tokens, audit metadata, and actor IDs are not returned to the UI.
Administrators cannot change their own role or status, and the API protects the
last active administrator. Suspending an account revokes its active sessions
and refresh tokens. Reactivation does not restore revoked sessions.

The web backend-for-frontend (BFF) checks the active role on every request,
keeps access cookies and CSRF tokens server-side, uses same-origin checks and a
bounded JSON body for mutations, and forwards only the expected query/body
fields. API writes continue to require the API's session-bound CSRF token.
Responses are `no-store`; failures are mapped to generic messages.

## Metric definitions

The selected transfer interval is inclusive of both ISO calendar dates in
UTC. If omitted, the API uses the 30 calendar days ending today in UTC. The
maximum interval is 366 days. Invalid dates, reversed intervals, and longer
ranges are rejected.

- Completed count and value include transfers whose `completedAt` falls in
  the interval; values remain integer minor units and are serialized as
  decimal strings.
- Recorded failed transfers are persisted `FAILED` rows whose `createdAt`
  falls in the interval. This is not a count of failed attempts that were
  rolled back and never recorded.
- Daily completed activity is grouped by completion date. Recorded failures
  are grouped by row creation date. Empty UTC dates are zero-filled.
- Registered users counts all account statuses and is a current global total,
  not a historical count for the selected interval.
- Pending operational work is the current global count of failed background
  jobs in `retry_pending` or `retrying`, plus outbox events in `pending`.
- Recent activity is the ten newest audit events globally. It contains only
  action, entity type, actor type, time, and outcome; it is not filtered by
  the transfer interval and excludes private metadata and actor identifiers.
- API readiness is an independent readiness probe and may be unavailable even
  when the dashboard's metrics request succeeds.

The dashboard shows exact daily counts and values alongside relative charts;
it does not calculate unsupported trend percentages or synthesize sample
metrics. User listing is paginated (20 by default, page 1–10,000, at most 100 per page) and
supports email substring, role, and status filters. The UI has loading, empty,
error, and refresh states and uses a compact card layout on small screens.

## Verification

Run `npm run typecheck --workspace @ledgerflow/api`,
`npm run typecheck --workspace @ledgerflow/web`,
`npm test --workspace @ledgerflow/api -- --runInBand`,
`npm run test:auth --workspace @ledgerflow/web`, and lint/build checks for both
workspaces. The API tests cover aggregation, UTC zero-filling, date bounds,
safe user records, and user lookup. Web tests cover role gates, output
allowlisting, same-origin mutation checks, CSRF forwarding, and existing auth
and session behavior.
