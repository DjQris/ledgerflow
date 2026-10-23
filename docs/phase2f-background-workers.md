# Phase 2F background workers

Start local PostgreSQL and Redis with `npm run db:up` and `npm run redis:up`,
apply migrations, then build the API. Run `npm run start:prod`,
`npm run start:dispatcher`, and `npm run start:worker` in separate terminals.
The dispatcher and worker need `DATABASE_URL` and `REDIS_URL`; the HTTP API
does not need Redis. Production Redis must use a private `rediss://` URL with
credentials supplied outside Git. Local Compose publishes Redis on loopback
only and uses an AOF-backed volume. The three processes handle SIGINT/SIGTERM
and close their database and Redis connections gracefully.

1. The transfer transaction commits a `transfer.completed` outbox row in
   PostgreSQL. It never calls Redis.
2. The dispatcher claims due rows with PostgreSQL `SKIP LOCKED` and a 60-second
   lease. It adds a BullMQ job named `transfer.completed` containing only
   `{eventId}` and uses that UUID as the stable job ID. It marks the row
   published only after Redis acknowledges the job. Failed additions schedule
   a bounded database retry. Redis reconnection requires restarting the
   dispatcher process after an outage; the database lease and retry schedule
   preserve unpublished events. An expired lease can be reclaimed; the new
   lease token fences the old publisher from changing outbox state.
3. The worker validates the job and reloads the committed transfer and outbox
   payload from PostgreSQL. It inserts a `processed_events` row and a
   `transaction_notifications` row in one transaction. The processed-event
   primary key and notification's unique event ID prevent duplicate records
   even if BullMQ delivers the same event again after restart. The recipient
   is the transfer source wallet's user. Notification status `recorded` means
   an internal record exists; no SMS or email is sent.

Jobs are retained in Redis after completion or failure so their stable IDs
continue deduplicating while outbox entries exist. Redis must be configured
for durable persistence in deployment; a volatile Redis acknowledged write
could otherwise be lost after the outbox row is marked published. Delivery is
at least once, not exactly once. Worker jobs retry transient failures with
BullMQ backoff; exhausted failures remain visible in Redis for operator
investigation. There is no retry-management API in this phase. Retention for
published outbox rows, processed-event identities, notifications, and BullMQ
jobs needs a coordinated policy before production rollout. Do not discard
processed-event identities while old jobs can be redelivered.

The integration suite exercises the full chain against the dedicated test
database and local Redis: one committed transfer, one UUID job, one recorded
notification, duplicate delivery after worker restart, competing dispatcher
instances, and failed Redis dispatch followed by recovery. Use
`INTEGRATION_DATABASE_URL=... npm run test:integration` after both services
are healthy. Request logs and job payloads exclude credentials and personal
contact information; dispatcher and worker logs contain event IDs and status.
