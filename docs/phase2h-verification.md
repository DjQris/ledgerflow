# Phase 2H verification report

Phase 2H is a verification and hardening pass over the Phase 1 and Phase 2
backend. It does not add a frontend, payment rail, or real email/SMS provider.
The financial API, dispatcher, and worker are separate processes. PostgreSQL
is the source of truth for sessions, permissions, financial journals, outbox
events, processed-event deduplication, audit history, and failure records.
Redis/BullMQ carries retryable background jobs, not the authoritative transfer.
The worker creates only an internal notification after verifying the committed
event. See [architecture](architecture.md), [financial model](financial-data-model.md),
[outbox](transactional-outbox.md), and [operations](operations.md).

## Review and changes

The review examined controllers and global guards, auth/session/CSRF logic,
financial transfer and idempotency transactions, outbox leases, worker/dispatcher
failure paths, logging, and process health. Two verified recovery gaps were
corrected without rewriting the financial workflow:

1. A failed BullMQ job whose earlier PostgreSQL row was still `retrying` was
   skipped by reconciliation. Reconciliation now upgrades that stale row to a
   durable dead letter.
2. A manual retry could remain `retry_pending` if the API stopped after its
   database commit but before enqueueing. An authorized repeat request now
   resumes the stable job ID. A queue error leaves the intent inspectable and
   retryable rather than silently reverting it to a dead letter.

API liveness was already present. Phase 2H adds API database readiness and
separate loopback-only liveness/readiness listeners for the dispatcher and
worker. The [operations runbook](operations.md) documents safe, read-only
measurements for unpublished outbox events, oldest age, failed jobs, worker
failure attempts, and transfer API latency. Existing logs contain safe request
metadata or fixed background reason codes; durable audit events record auth,
authorization, transfer, and manual-recovery decisions.

No database migration was added in Phase 2H. Phase 2G's
`20261023170000_add_background_failures` remains the latest migration.

Files changed in this phase: `.env.example`, `README.md`,
`apps/api/src/auth/auth.integration-spec.ts`, `apps/api/src/background/`
(`background-environment`, `failure.service`, `ops-jobs.controller`,
`ops-jobs.service`, `phase2g.integration-spec`,
`transfer-completed.processor`, new `health-server` and `readiness` code/tests),
`apps/api/src/health/` (controller/module/service/tests),
`apps/api/src/main-dispatcher.ts`, `apps/api/src/main-worker.ts`, and
`docs/` (`architecture.md`, `financial-data-model.md`,
`phase2g-failure-recovery.md`, this report, `operations.md`, and
`frontend-integration-contract.md`).

The only new API route is public `GET /api/v1/health/ready`; it returns 200 or
503 and no connection detail. The background processes add local `/live` and
`/ready` probes on their own ports. Existing protected routes include
authentication, wallets, transfers, audit inspection, admin user management,
and operations failure inspection/retry; see the
[frontend integration contract](frontend-integration-contract.md) for methods,
roles, payloads, and response formats. Phase 2 security controls include
database-backed sessions, hashed refresh tokens, atomic rotation/reuse
revocation, bcrypt passwords, exact-origin checks, session-bound CSRF,
deny-by-default RBAC, wallet ownership rechecks, bounded inputs/throttling,
sanitized logging, append-only audit records, and PostgreSQL financial
constraints.

## Verification evidence

The commands below used the dedicated `ledgerflow_phase1f_integration_*`
database and local Redis, not a development or production financial database.
Results are from the Phase 2H run on 2026-10-23:

| Command or check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run format:check` | Passed |
| `npm test` | 38 unit tests passed |
| `npm run test:integration` | 42 core, 4 Phase 2F, 8 Phase 2G tests passed |
| `npm run test:concurrency` | 20 targeted concurrency tests passed |
| `npm run build` | Passed |
| `npm audit --omit=dev --audit-level=high` | Zero reported vulnerabilities |
| `npm run ledger:verify` | `ok: true`, no issues |
| Live dispatcher/worker `/live` and `/ready` smoke | All four returned 200 and both processes shut down cleanly |
| `npm run db:validate` | Blocked: the managed network returned 403 for Prisma's schema-engine checksum download |

The integration suite verifies registration/login, password hashing, JWT
tampering/expiry, session revocation, refresh rotation/replay and concurrency,
suspension, per-account login throttling, CSRF, role/ownership isolation,
admin audit, transfer atomicity, idempotency, ledger invariants, Redis outage
recovery, duplicate delivery, worker restart and post-commit retry, exhaustion,
inspection, and authorized manual recovery. Unit tests cover the new probe
logic; integration tests cover the two corrected crash windows.

## Requirements and limitations

- [x] Review Phase 2 architecture and correct verified recovery gaps.
- [x] Run existing authentication, authorization, Phase 1 financial, and
  background resilience regression suites.
- [x] Add API, worker, and dispatcher readiness checks.
- [x] Document structured observability and useful read-only measurements.
- [x] Update architecture and add authentication/event Mermaid diagrams.
- [x] Document the Phase 3 API integration contract without building a frontend.

This is not a production-readiness claim. A literal OS-level hard-kill in the
middle of a worker transaction was not exercised; tests cover a stopped worker
and a simulated post-commit/pre-acknowledgement failure. The current local
integration database had the Phase 2G migration applied before this pass; a
fresh `prisma migrate deploy` on an empty database was not rerun here because
the managed environment cannot fetch Prisma's schema-engine binary (HTTP 403).
No checksum bypass was used. There is
no Phase 2H schema change. Redis and PostgreSQL failover, sustained load,
multi-instance rate limiting, trusted proxy configuration, first-admin
provisioning, audit/outbox retention, real notification delivery, and disaster
recovery require separate deployment work. Process probes show dependency
health at request time, not a service-level availability guarantee.
