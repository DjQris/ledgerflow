# Phase 4A — Test Infrastructure and Baseline

## Scope and current implementation inventory

LedgerFlow is an npm-workspace repository with a NestJS 12 / Prisma 7.10 API,
PostgreSQL 18, Redis 7.4 / BullMQ 6 background processing, a Next.js 16
frontend, Jest 30 / Supertest API tests, Vitest 5 component tests, and a
Playwright Chromium shell verifier. Prisma schema changes are represented by
committed migrations under `apps/api/prisma/migrations`; the Phase 4 flow uses
`prisma migrate deploy`, never `db push`.

Existing financial writes use PostgreSQL transactions for ledger journals,
transfer state, idempotency records, audit records, and outbox events. Database
triggers protect posted ledger entries and cached wallet-balance projections.
Background delivery claims outbox events and processes notifications through a
deduplicated BullMQ queue; durable retry/failure state is kept in PostgreSQL.
Auth uses signed cookies, CSRF/origin checks, roles, and wallet ownership checks.
These are test invariants, not relaxation points. See
[`financial-data-model.md`](financial-data-model.md),
[`transactional-outbox.md`](transactional-outbox.md), and
[`phase2g-failure-recovery.md`](phase2g-failure-recovery.md) for implementation
details.

The repository's original `compose.yaml` is the development stack and owns
`ledgerflow_postgres_data` and `ledgerflow_redis_data`. Historical integration
suites previously checked only a database-name prefix and Phase 2F/2G defaulted
to Redis at port 6379. Those checks could not rule out an unsafe host/port or
the ordinary development Redis. Phase 4 adds a distinct `compose.phase4.yaml`
stack, an explicit fail-closed integration environment guard, and separate API
unit/integration invocation. No Phase 1–3 behavior or financial rule was
intentionally changed.

## Isolated environment

| Service      | Image                        | Host binding              | Database / persistence                                                    | Credentials and guard                                                                                                                                                                                                                                          |
| ------------ | ---------------------------- | ------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL   | `postgres:18-alpine`         | `127.0.0.1:55432` only    | `ledgerflow_phase1f_integration_phase4`; Compose project-scoped volume    | Dedicated test user and randomly generated local-only password stored mode `0600` in ignored `artifacts/phase4/compose.env`; guard also requires the exact credential, DB prefix, user/port/loopback host, `NODE_ENV=test`, and `LEDGERFLOW_PHASE4_TEST_RUN=1` |
| Redis        | `redis:7.4-alpine`           | `127.0.0.1:56379` only    | Dedicated process, database 0, persistence disabled                       | Background suites require exactly this loopback Redis URL; the default development Redis port is rejected                                                                                                                                                      |
| Signing key  | Generated at test invocation | In process only           | Not persisted                                                             | Random 48-byte key; never sourced from a production secret                                                                                                                                                                                                     |
| Test records | Synthetic only               | Isolated PostgreSQL above | Deterministic seed identities; integration-created records are disposable | Never use production data, real payment rails, or real-money transactions                                                                                                                                                                                      |

The test PostgreSQL password is generated per local setup and is not committed;
it is a disposable Compose credential, not a production secret. Both host ports bind to loopback. Compose's project name
`ledgerflow-phase4-test` and its separate file scope `down` and reset volume
operations away from development services. `phase4:down` stops services while
retaining the isolated database; `phase4:reset` is the explicit destructive
reset and targets only that fixed test project/volume. If reset setup fails,
its script stops/removes the Phase 4 containers/network and retains only the
fresh Phase 4 volume for diagnosis.

## Clean setup and reproduction

Requirements: Node.js 22+, npm 10+, Docker Engine with Compose v2 and permission
to access its daemon, plus Chromium at `/usr/bin/chromium` for the browser check.
From the repository root:

```bash
npm ci
npm run phase4:reset
npm run phase4:baseline
npm run phase4:down
```

`phase4:reset` creates the isolated services, waits for health, applies the
committed Prisma migrations, then runs the existing idempotent development seed
against the guarded test URL. `phase4:baseline` runs API unit/type/lint checks,
frontend component and money tests/type/lint checks, API integration suites,
the concurrency suite, ledger verification, and the existing Playwright login
and registration shell checks. The browser check starts Next.js on a dedicated
loopback port and does not submit credentials or use an authenticated account.
Database-backed customer/admin browser journeys require an explicitly
authorized synthetic QA account and are not part of this baseline. Reports and
logs are emitted under ignored `artifacts/phase4/`; `baseline.json` summarizes
each command and `environment.json` captures runtime and machine information.

Individual safe operations:

```bash
npm run phase4:up       # start only the Phase 4 test services
npm run phase4:migrate  # apply committed migrations to that exact database
npm run phase4:seed     # idempotently seed synthetic wallets into that database
npm run phase4:down     # stop only the Phase 4 project; retain its volume
npm run phase4:reset    # delete/recreate only the Phase 4 project and test volume
```

Do not pass a custom database or Redis URL into these scripts. Direct API
integration invocations without the explicit guard fail before constructing a
database client. The generic development seed command remains for local use;
the Phase 4 documented path always supplies its isolated URL.

## Test matrix and invariants

| Scenario IDs  | Suite / command                      | Core coverage                                                                                                           | Financial/security invariants                                                                                   |
| ------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| API-UNIT-01   | API Jest unit tests                  | Money units, environment validation, ledger, transfers, auth, RBAC, audit, outbox, readiness and failure classification | Exact integer minor units; auth and authorization rules remain enabled                                          |
| API-DB-01     | Core PostgreSQL integration          | Identity ownership, auth/CSRF, audit/integrity, outbox lease, ledger and transfer persistence                           | No cross-user access; balanced journals; immutable posted entries; atomic rollback; no partial financial writes |
| API-DB-02     | Phase 2F integration                 | Outbox-to-BullMQ delivery and worker restart                                                                            | One job/notification per event; delivery follows committed transfer/outbox transaction                          |
| API-DB-03     | Phase 2G integration                 | Retry, recovery, and operations authorization                                                                           | Bounded retry and durable recovery; no unauthorized manual retry                                                |
| API-CONC-01   | HTTP concurrency harness, ten rounds | Repeated idempotent requests and competing debits                                                                       | One idempotent outcome; aggregate debits cannot overspend; journals remain balanced                             |
| API-VERIFY-01 | Ledger verifier                      | Full seeded/test ledger consistency                                                                                     | Projection-to-ledger consistency and journal balance                                                            |
| WEB-UNIT-01   | Vitest                               | Authentication, customer/operations BFFs, forms, routes, shell, transactions                                            | Role/ownership-aware UI contracts and safe minor-unit handling                                                  |
| WEB-MONEY-01  | Node money tests                     | Formatting and amount parsing                                                                                           | No floating-point money conversion or invalid precision                                                         |
| WEB-E2E-01    | Playwright shell verifier            | Login/register at 360, 390, 768, 1024, 1440px; keyboard, validation and responsive overflow                             | No real credentials are submitted; no authenticated cookie or production endpoint is used                       |

### Must remain true in all later phases

- Posted ledger entries are append-only and every journal balances to zero.
- A transfer's ledger, wallet projections, status, idempotency result, audit,
  and outbox record commit atomically or not at all.
- Concurrent transfers cannot overspend; the same idempotency key and payload
  do not double-post, while a conflicting payload is rejected.
- A user can read or mutate only resources authorized to their identity and
  role; CSRF and origin protections remain enabled on cookie-authenticated
  writes.
- Outbox claiming, job IDs, processing, notifications, and retries remain
  idempotent and durable across restarts.
- Tests use synthetic wallets/users and never call real payment providers.

## Environment and privacy recording

Each baseline stores Node/npm versions, OS/architecture, logical CPU count,
reported host memory, local image tags, the isolated database/Redis endpoints,
and command-level logs/reports. Test database starts from committed migrations
and the two deterministic synthetic development wallets. Individual suites add
synthetic financial records. No real customer data, production credentials,
access cookies, or secrets are copied to artifacts. Signing keys are generated
in memory. Artifacts are git-ignored. Inspect generated logs before sharing
them outside the local workspace.

## Baseline status and known issues

Actual outcomes are written by `npm run phase4:baseline` under ignored
`artifacts/phase4/baseline.json`. The first baseline in this workspace was run
on 2026-10-29 with Node 24.19.0, npm 11.9.0, Docker 28.4.0 / Compose 2.40.3,
Linux 6.18.55 x64, 3 reported logical CPUs, and 10,452,471,808 bytes of
reported memory. Chromium was available at `/usr/bin/chromium`.

| Baseline item                                                                               | Outcome                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API unit                                                                                    | 66/66 passed across 18 suites after loopback permission was granted                                                                                                                                                                                                                                                                        |
| API typecheck / lint                                                                        | Passed / passed                                                                                                                                                                                                                                                                                                                            |
| Repo-wide API Prettier check                                                                | Fails on 9 existing access-control/operations files outside this phase; every Phase 4-changed TypeScript file passes Prettier                                                                                                                                                                                                              |
| Frontend component tests                                                                    | 101/101 passed across 46 suites                                                                                                                                                                                                                                                                                                            |
| Frontend money tests                                                                        | 2/2 passed                                                                                                                                                                                                                                                                                                                                 |
| Frontend typecheck / lint                                                                   | Passed / passed                                                                                                                                                                                                                                                                                                                            |
| Playwright shell                                                                            | Passed: login and registration at 360, 390, 768, 1024, and 1440px; keyboard/validation checks passed. Authenticated route checks were skipped because no dedicated QA access cookie was supplied.                                                                                                                                          |
| Phase 4 PostgreSQL/Redis startup, health, generated-password authentication, and Redis ping | Passed; created only `ledgerflow-phase4-test` resources and the isolated test volume                                                                                                                                                                                                                                                       |
| Prisma generate/migrations/seed                                                             | Blocked: Prisma's schema-engine checksum endpoint returned HTTP 403. The checksum check was not bypassed.                                                                                                                                                                                                                                  |
| API PostgreSQL/background integration, concurrency, ledger verification                     | Skipped because schema generation/migration did not complete; these results are unrun, not passes                                                                                                                                                                                                                                          |
| Reset and safe service teardown                                                             | Reset removed/recreated only the task-created, empty Phase 4 test volume; its generated credential authenticated and Redis responded. Prisma generation then blocked on HTTP 403, so reset automatically stopped/removed the Phase 4 containers/network and retained only its named test volume. The development project was not targeted. |
| Database row-count snapshot                                                                 | Not available: no migrations or seed were applied                                                                                                                                                                                                                                                                                          |

The Compose services and static artifacts are validated, and normal scoped
`down` teardown was executed. The full clean-reset/migrate/seed path and
database-backed acceptance criteria remain incomplete until Prisma's engine
checksum service is reachable. Do not set
`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` or otherwise bypass the verification
check. A browser listener restriction initially blocked API/Playwright tests;
after narrowly scoped local execution access, both passed as reported above.
Commands that cannot run are recorded as failed or skipped, never passed.

## Phase 4B — API/client contracts and integrated browser journeys

`apps/api/openapi.json` is generated from the actual Nest route/decorator
metadata by `npm run phase4:openapi`; it is not a separately authored API
schema. Generation constructs the Nest application only long enough to read
route metadata and does not initialize it, open a database connection, or bind
a port. `npm run phase4:contract` checks the generated versioned API operations
against `apps/web/api-contract-map.json`, requires every actual API operation
to be mapped exactly once (including intentionally backend-only routes), and
checks the auth/CSRF/idempotency, pagination, money serialization, and relevant
error response declarations. `npm run phase4:matrix` renders the human-readable
[`api-contract-matrix.md`](api-contract-matrix.md) from that same mapping.

The comparison found documentation gaps and they were repaired conservatively:
explicit throttles now declare `429`; wallet/transaction ownership and audit
query validation errors are declared; pagination metadata is described as
typed non-negative integer fields rather than only an example object. Money
DTOs continue to serialize minor units as strings. The BFF tests now also
assert that malformed pagination, numeric (rather than string) wallet balance,
and malformed successful transfer payloads fail closed.

Full real-service journeys are implemented in
[`scripts/phase4/e2e.mjs`](../../scripts/phase4/e2e.mjs) and launched only by
`npm run phase4:e2e`. The runner requires the exact isolated Phase 4 PostgreSQL
and Redis endpoints, binds API/web only to loopback ports 43000/43101, uses
fresh random customer identities and an ephemeral operations identity, and
generates a temporary test signing key. Guarded fixture actions use only the
`ledgerflow_phase1f_integration_*` database; they create synthetic NGN opening
funding and a synthetic failed-job inspection record tied to a test transfer.
No HTTP fixture or test bypass is added to the application. Reset the isolated
test project with `npm run phase4:reset` before/after a run when deterministic
cleanup is needed; never substitute another database or Redis endpoint.

The browser journey uses real UI registration/login, API-created wallets,
wallet display, transfer confirmation, a controlled one-request local browser
transport interruption followed by same-key verification, transaction
history, and an operations account reading the generated audit event and
synthetic failed-job record. It also checks CSRF rejection, cross-customer
wallet/transfer denial, 60-second access-token expiry, refresh-token rotation,
and logout. Browser network interception is limited to aborting the first
synthetic transfer request; the retry and all other journey requests reach the
real local services. API integration suites cover suspended users, refresh
reuse, CSRF/origin handling, wallet ownership, and account rate limits; frontend
unit tests cover network errors and malformed response payload handling.
Failure screenshots and traces are only captured on test failure.

Phase 4B validation so far: generated OpenAPI contains 30 operations and the
contract check passes; API build/typecheck/lint pass; frontend auth/client test
suite passes 103 tests across 23 files; frontend typecheck/lint pass. The full
browser journey is not claimed as passed: the local Docker daemon is not
accessible in this execution environment, and the earlier Phase 4 baseline
also recorded Prisma's verified schema-engine download as HTTP 403. Therefore
the migrations, API PostgreSQL/background integration, and this browser
journey remain unrun until the isolated test services and Prisma engine are
available without bypassing checks.

| Priority | Issue / gate                                                                                                                                                 | Required before                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| P0       | Restore trusted access to Prisma's schema-engine checksum endpoint and complete migration, seed, integration, concurrency, and ledger-verification scenarios | Any database-backed test claim                        |
| P0       | Resolve any failing financial invariant, auth/CSRF, ownership, outbox, retry, or concurrency tests                                                           | Further feature phases or production readiness claims |
| P1       | Install/provide the pinned local Chromium executable and rerun the shell verifier if unavailable                                                             | Calling the browser QA scenario passed                |
| P1       | Establish an explicitly authorized synthetic QA account and browser flow before protected-route end-to-end tests                                             | Full customer/admin browser journeys                  |
| P2       | Track unit/type/lint failures separately from infrastructure blockers; fix confirmed code regressions before broader scenarios                               | Expanding test coverage                               |
| P2       | Resolve the 9 existing API formatting failures in access-control/operations files without mixing that cleanup into Phase 4A                                  | Clean repository-wide formatting check                |

No performance, load, stress, or fault-injection tests are authorized in this
phase. Never direct such tests at production or a shared endpoint.
