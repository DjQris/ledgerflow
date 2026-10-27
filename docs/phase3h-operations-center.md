# Phase 3H operations center and financial monitoring

Phase 3H replaces the jobs, audit, and reconciliation placeholders with
protected tools over existing PostgreSQL-backed operations data and the
existing ledger-integrity verifier. `OPERATIONS` and `ADMIN` can inspect these
surfaces; backend role policies remain authoritative. No frontend route can
modify ledger entries, balances, or audit events.

## Failed jobs and safe retry

`GET /api/v1/ops/jobs/failed` now supports bounded status, processor source,
event type, and limit filters (maximum 100 rows). It returns the sanitized
failure reason code and durable attempts/timestamps, plus matched event type,
outbox processing status, transfer status, and transfer ID where the
`transfer.completed` event and aggregate match. Job detail exposes no Redis
job payload, outbox payload, raw error, cookies, or credentials. Current event
types are restricted to the supported `transfer.completed` workflow.

`POST /api/v1/ops/jobs/:id/retry` remains the only retry mutation. It locks the
failure record, rechecks current active staff authorization and event state,
handles already-processed events, and writes an audit event. It only requeues
the existing notification event; it never calls the transfer API or repeats
ledger posting. UI confirmation precedes the request. A queue outage can leave
a durable `retry_pending` intent, so the UI reports this uncertainty and
refreshes the job state before another request.

## Audit log

The existing `GET /api/v1/audit-events?limit=...` array contract remains
available. The new protected `GET /api/v1/audit-events/search` supports
bounded pagination, action/entity type, outcome, actor/resource/action search,
and inclusive UTC calendar-day filters. Ordering is newest event first with
the event ID as a stable tie-breaker. Audit records remain read-only.

Both audit reads now return action-specific allowlisted context, not arbitrary
stored metadata. This retains safe values such as sanitized failure reasons,
role transitions, transfer amounts, and journal/event IDs while excluding
unknown fields and fingerprints. Context is further allowlisted at the web
BFF before rendering. Actor, resource, action, outcome, and timestamp remain
available for investigation.

## Ledger reconciliation

`GET /api/v1/ops/reconciliation` is a throttled, authenticated read-only call
to the same `LedgerIntegrityService` used by `npm run ledger:verify`. It runs
inside a repeatable-read transaction and reports posted journal count, wallet
count, ledger-account count, and real balance/journal discrepancy records. A
UUID report ID identifies each verification response; reports are not stored
as historical records. The checks compare internal ledger journals and
wallet projections only; there is no external settlement feed or settlement
comparison in this phase. The endpoint and UI never repair data.

## Refresh and verification

Job and audit queries use bounded 60-second polling, visible last-checked and
stale states, and manual refresh. Reconciliation runs on page load and only
runs again on explicit refresh. Empty, denied, loading, stale, queue/backend
error, and real discrepancy states are distinct. Responsive tables have
compact mobile-card layouts.

Run API and web typecheck/lint/test/build checks. Unit tests cover safe audit
context, pagination/date filters, actual verifier reports, RBAC and CSRF in the
BFF, confirmation and retry states, backend outages, empty results, and mobile
layouts. The existing Phase 2G integration suite remains the end-to-end source
of truth for eligibility, concurrency, and non-repetition of financial writes.
