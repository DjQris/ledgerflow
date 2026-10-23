# Operations and observability

The three processes have separate readiness contracts. `GET /api/v1/health`
is API liveness; `GET /api/v1/health/ready` returns HTTP 200 when PostgreSQL is
reachable and HTTP 503 otherwise. It intentionally ignores Redis: the transfer
transaction and its outbox insert must remain available during a Redis outage.
The dispatcher serves `http://127.0.0.1:3101/live` and `/ready`; the worker
serves `http://127.0.0.1:3102/live` and `/ready`. Background readiness checks
PostgreSQL and Redis, and the worker also checks that its processor is running.
These listeners bind to loopback only, return no configuration or credentials,
and return 503 after a two-second readiness timeout. Configure the ports with
`DISPATCHER_HEALTH_PORT` and `WORKER_HEALTH_PORT` when colocating instances.
Run process liveness checks and restart failed processes through the supervisor.
Do not mistake a healthy API for a healthy dispatcher or worker.

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
curl -fsS http://127.0.0.1:3101/ready
curl -fsS http://127.0.0.1:3102/ready
```

The API's structured `HttpRequest` log contains request ID, method, route
template, HTTP status, duration in milliseconds, and authenticated actor ID.
Filter it by `POST /api/v1/transfers` to measure transfer API latency from
actual traffic; this repository does not claim a latency benchmark. It never
logs query strings, request bodies, cookies, CSRF tokens, or idempotency keys.
Authentication successes/rejections, denied authorization, transfer outcomes,
and manual recovery decisions are structured, append-only PostgreSQL audit
events. Background logs carry only stable event/job IDs and fixed reason codes
for publication, retry, dead-letter, and recovery failures. Restrict access to
logs and audit records and set a reviewed retention policy before deployment.

OPERATIONS and ADMIN users can inspect `GET /api/v1/ops/outbox`,
`GET /api/v1/ops/jobs/failed`, and `GET /api/v1/ops/jobs/:id`. These return
bounded results and no event payloads. For aggregate measurements, run the
following read-only queries with a restricted database account. A `NULL` oldest
age means there is no unpublished event. Counts are point-in-time, not a
metrics time series; `attempts` is cumulative per failure record, not an exact
count of every worker process invocation.

```sql
SELECT count(*) FILTER (WHERE status IN ('pending', 'claimed')) AS unpublished_events,
       EXTRACT(EPOCH FROM now() - min(created_at) FILTER
         (WHERE status IN ('pending', 'claimed'))) AS oldest_unpublished_age_seconds,
       count(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_events
FROM outbox_events;

SELECT count(*) FILTER (WHERE status = 'dead_letter') AS failed_jobs,
       count(*) FILTER (WHERE source = 'worker' AND status = 'dead_letter')
         AS failed_worker_jobs,
       coalesce(sum(attempts) FILTER (WHERE source = 'worker'), 0)
         AS recorded_worker_failure_attempts
FROM failed_background_jobs;
```

If Redis is unavailable, the API can still commit a transfer and its outbox
event; dispatcher readiness becomes 503. Restore Redis, keep the dispatcher
running or restart it, and confirm the pending count and oldest age decline.
If the worker is unavailable, jobs remain in BullMQ; restart it and verify
`processed_events`/`transaction_notifications` remain unique. Inspect dead
letters, repair the underlying cause, and use audited `POST /ops/jobs/:id/retry`
only for eligible events. Never replay a financial transfer as a recovery step.
Run `npm run ledger:verify` after suspected financial inconsistency.
