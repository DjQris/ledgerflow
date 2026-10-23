# Phase 2E transactional outbox

`outbox_events` stores durable events beside the financial tables. A transfer's
ledger posting, completed transfer row, audit event, idempotency response, and
`transfer.completed` outbox row commit in the same PostgreSQL transaction. Any
failure rolls them all back. The partial unique index on `aggregate_id` for
`transfer.completed` is a database backstop against duplicate completion
events. Event version 1 contains only `eventType`, `eventVersion`, `eventId`,
`transferId`, and `occurredAt`; it contains no credentials, balances, wallet
owner, email, or authentication/session data.

Phase 2F adds a separate dispatcher and BullMQ worker (see [background workers](phase2f-background-workers.md)). The dispatcher
claims due pending rows and expired leases with one `UPDATE ... FROM` using
`FOR UPDATE SKIP LOCKED`. Each claim increments `attempts` and replaces the
UUID lease token. Acknowledgement and retry require the current owner, token,
and an unexpired lease, so an old worker cannot change a newer claim. Retrying
stores only a bounded error code, never raw exception text. A worker crash
after external delivery but before acknowledgement may cause another delivery;
consumers must deduplicate using `eventId`. This design guarantees a durable
event row, not exactly-once external delivery.

Phase 2G quarantines permanently invalid rows as `dead_letter`, recording a
sanitized, durable [failure record](phase2g-failure-recovery.md). Operations
staff can inspect and requeue a repaired event; neither this action nor the
worker repeats the financial transfer.

Retention is deliberately manual for now. Do **not** delete pending, claimed,
or dead-letter events. Before production use, set a reviewed retention period
for published rows (for example 90 days), ensure consumer replay windows and backup
retention fit within it, and implement a separately audited, batched purge of
published rows only. Limit database access to the API and dispatcher
roles; do not expose the payload through a public HTTP endpoint or copy it into
request logs. Review each new event version for data minimization and any
personal-data retention obligations before release. Backups containing outbox
rows need the same access and deletion policy as the financial database.
