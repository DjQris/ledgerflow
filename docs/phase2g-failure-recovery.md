# Phase 2G failure recovery

`transfer.completed` background work only creates an internal notification.
The original transfer, ledger entries, and wallet balances were committed before
the outbox event was visible. Retries and manual recovery never call the
financial transfer service, so they cannot debit or credit a wallet again.

BullMQ jobs default to five total attempts with exponential backoff and 50%
jitter. `BACKGROUND_JOB_MAX_ATTEMPTS` (1–20), `BACKGROUND_RETRY_DELAY_MS`
(100–60000), and `REDIS_CONNECT_TIMEOUT_MS` (500–30000) are configurable.
Worker concurrency is capped at five. Redis connection interruptions and
database/service outages are temporary. Invalid jobs, unsupported versions,
and irrecoverable missing or mismatched event data stop immediately. Failure
reasons are fixed codes, not exception text, SQL values, payloads, or secrets.

`failed_background_jobs` persists the event and job identity, category, safe
reason code, cumulative attempts, first/last failure times, status, and initiating retry
actor. It survives BullMQ retention. The worker records each failure; if the
database is down during an exhausted failure, it reconciles failed Redis jobs
on startup and every 15 seconds after recovery. Invalid outbox rows are
atomically moved to `dead_letter` with a durable failure record. Temporary
Redis publishing failures remain pending in the outbox with a database retry
time. A stopped dispatcher must be restarted after Redis becomes available.

Active OPERATIONS or ADMIN users may use these authenticated routes (all under
`/api/v1`):

- `GET /ops/jobs/failed` — up to 100 durable dead letters (`?limit=50`).
- `GET /ops/jobs/:id` — one failure record by its UUID.
- `GET /ops/outbox` — recent delivery metadata, never payloads.
- `POST /ops/jobs/:id/retry` — audited retry request with the session-bound
  `X-CSRF-Token` header.

Manual retry locks the failure row, rechecks the actor's current role, and
checks `processed_events` before queueing. Concurrent requests cannot both
schedule the same job. A processed event returns `already_processed`. A worker
failure uses the stable event UUID job ID, resetting BullMQ's attempt counter;
an outbox dead letter becomes pending for the dispatcher after its event is
repaired. Invalid or unrepaired events return a conflict. Notification inserts
and processed-event markers remain atomic and unique in PostgreSQL.

Integration tests use a dedicated database and local Redis to simulate
invalid jobs, stopped workers, failure after the PostgreSQL commit but before
queue acknowledgement, exhausted database-write failures, RBAC and CSRF,
manual retry, unsupported outbox versions, and unchanged ledger balances.
