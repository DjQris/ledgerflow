# LedgerFlow

LedgerFlow is an npm-workspace monorepo containing a NestJS API, a PostgreSQL/Prisma ledger, and a Next.js frontend shell. See the [architecture diagram](docs/architecture.md), [financial data model](docs/financial-data-model.md), [frontend setup notes](docs/phase3a-frontend-setup.md), and [design-system notes](docs/phase3b-design-system.md).

The stack is TypeScript, NestJS, PostgreSQL 18, Prisma, Jest, and Supertest. Swagger documents the HTTP API.
The current major versions are NestJS 12, Prisma 7.10, BullMQ 6, TypeScript 5.9,
Jest 30, and Supertest 7. Local Compose uses PostgreSQL 18 and Redis 7.4;
Node.js 24 LTS is recommended. The lockfile selects exact npm package versions.

## Prerequisites

- Node.js 24 LTS (Node.js 22 or newer is supported)
- npm 10 or newer
- Git
- Docker with Docker Compose

## Installation

```bash
git clone <repository-url> ledgerflow
cd ledgerflow
cp .env.example .env
npm ci
npm run db:up
npm run redis:up
npm run db:migrate:deploy
npm run db:generate
npm run db:seed
```

The defaults in `.env.example` are safe for local development. Keep real secrets in `.env`; local environment files are ignored by Git. Authentication remains unavailable until you set a private `AUTH_SIGNING_KEY` of at least 32 random bytes, for example by generating one locally with `openssl rand -hex 48` and copying it into `.env`. Never commit or share the key.

`db:up` starts PostgreSQL 18 on `127.0.0.1:5432`. `redis:up` starts Redis on `127.0.0.1:6379` with persistent append-only storage. Both use named Docker volumes. Confirm they are healthy with `docker compose ps`. PostgreSQL's Compose service is unchanged.

`db:seed` is restricted to local and test environments. It creates the simulated `test-ada` and `test-tobi` NGN wallets and posts balanced development opening-funding journals. It is safe to rerun: stable owner and external references prevent duplicate wallets or opening balances.

Phase 2A also creates a suspended, passwordless provisional `User` for each seeded or newly simulated wallet. No development login password is shipped or required.

## Start the API

```bash
npm run start:dev
```

The development server exposes:

- Health check: <http://localhost:3000/api/v1/health>
- Database readiness: <http://localhost:3000/api/v1/health/ready>
- Swagger UI: <http://localhost:3000/docs>

For a compiled local run:

```bash
npm run build
npm run start:prod
```

Run the dispatcher and worker independently in two more terminals after `npm run build`:

```bash
npm run start:dispatcher
npm run start:worker
```

Each background process serves loopback-only `/live` and `/ready` probes: the
dispatcher defaults to `127.0.0.1:3101`, and the worker to `127.0.0.1:3102`.
Their ports are configurable with `DISPATCHER_HEALTH_PORT` and
`WORKER_HEALTH_PORT`. Readiness requires PostgreSQL and Redis; worker readiness
also requires its BullMQ processor to be running. The API's readiness check
requires PostgreSQL but deliberately does not require Redis, so financial
transfers can continue while outbox delivery is delayed. See the
[operations runbook](docs/operations.md) for probes and measurements.

Financial HTTP requests do not connect to Redis. Phase 2G's protected manual-retry operation does, so the API, dispatcher, and worker all need `REDIS_URL`; production requires a private `rediss://` endpoint. See [background workers](docs/phase2f-background-workers.md) and [failure recovery](docs/phase2g-failure-recovery.md). Redis is bound to loopback in local Compose and must not be exposed publicly.

## Wallet API

Phase 2C protects wallet management under `/api/v1/wallets` with the access cookie:

- `POST /api/v1/wallets` creates one zero-balance NGN wallet for the signed-in customer. Its body must be `{}`; client-supplied owner IDs and references are rejected.
- `GET /api/v1/wallets` lists the customer's wallets, or all wallets for OPERATIONS/ADMIN investigation.
- `GET /api/v1/wallets/:id` and `GET /api/v1/wallets/:id/transactions?page=1&pageSize=20` require ownership for CUSTOMER; staff may read them for investigations.
- `POST /api/v1/wallets/simulated` retains provisional `test-*` wallet creation for a signed-in ADMIN on local loopback in development/test only. It is unavailable in production and does not enroll its suspended provisional owner.

There is intentionally no public funding endpoint. Development opening balances are created only by `npm run db:seed` as balanced ledger journals.

## Phase 2A identity preparation

The database now contains `User`, `AuthSession`, and `RefreshToken` models. Every wallet has a required `userId` foreign key. Existing wallet IDs, balances, journals, transfers, and audit events are preserved. The migration creates one provisional customer user per existing wallet, using the wallet UUID as the user UUID and a unique `simulated-<wallet-uuid>@ledgerflow.invalid` address. These users are suspended and have `passwordHash = NULL`; they cannot be used to sign in. New simulated wallets provision the same kind of user in the wallet-creation transaction. The legacy `ownerReference` remains for Phase 1 API compatibility.

Phase 2B activates `auth/` and `security/` for new customer registration and sessions. Phase 2C adds deny-by-default role and ownership checks to financial routes. `.env.example` contains no signing key or user passwords. Do not activate or reuse provisional identities without an explicit ownership-verification and credential-setting flow in a later phase.

For an existing database, take a recoverable backup, stop the old API, run `npm run db:migrate:deploy`, regenerate Prisma Client, then start the updated API. The Phase 2A migration runs in a PostgreSQL transaction, backfills all existing wallets, verifies ownership is complete, and only then sets `wallets.user_id` to `NOT NULL` and adds its foreign key. Old API instances cannot create wallets after the new constraint is in place, so do not run old and new versions together during this migration. See [the identity migration notes](docs/phase2a-identity-migration.md) for verification queries and compatibility risks.

## Phase 2B authentication

Set a private `AUTH_SIGNING_KEY` in `.env` before using the following routes. `AUTH_ALLOWED_ORIGIN` and every `CORS_ALLOWED_ORIGINS` entry must exactly match a trusted browser application's origin. For HTTPS deployment, use HTTPS origins and `AUTH_COOKIE_SECURE=true`; production startup rejects missing signing keys, non-HTTPS origins, or insecure cookies. The signing key must remain stable across API restarts and instances, or existing access and CSRF tokens will stop validating.

- `POST /api/v1/auth/register` accepts `{ "email": "customer@example.com", "password": "..." }` and creates an active CUSTOMER. Email is trimmed and lowercased; password must have at least 12 characters and fit within bcrypt's 72-byte UTF-8 limit. The response contains only `id`, `email`, `role`, and `status`.
- `POST /api/v1/auth/login` accepts the same credentials, creates a PostgreSQL session, and sets HTTP-only access and refresh cookies. Unknown accounts, wrong passwords, and suspended accounts receive the same generic failure.
- `GET /api/v1/auth/me` requires an unexpired access cookie and active database session, and returns the same safe identity fields.
- `POST /api/v1/auth/refresh` rotates the opaque refresh cookie and access cookie; the presented token is consumed atomically. A reused token revokes its entire session, including newly rotated cookies, even if the reuse came from two simultaneous requests.
- `POST /api/v1/auth/logout` revokes the session and its refresh tokens, and clears both cookies. Logout and reuse revocation take effect immediately for access tokens because every authenticated request checks the database session.

Access JWTs last 15 minutes by default and are checked for signature, algorithm, issuer, audience, and expiry. Refresh tokens last up to seven days and only SHA-256 hashes are stored in PostgreSQL. Cookies use `HttpOnly`, `SameSite=Lax`, path `/`, and no domain; HTTPS mode also uses `Secure` and the `__Host-` prefix. Browser-originated writes are restricted to the configured origin, while requests without browser origin/fetch metadata are allowed for non-browser clients.

## Phase 2D HTTP security

Browser clients must send cookies with `credentials: 'include'`. Login returns a session-bound `X-CSRF-Token` response header; the client can also obtain a token with authenticated `GET /api/v1/auth/csrf` (JSON `csrfToken`). Send that token in `X-CSRF-Token` on every authenticated POST, PUT, PATCH, or DELETE request, including transfers, wallet creation, admin changes, refresh, and logout. Refresh returns a fresh token in the response header. Register and login are CSRF-exempt but still enforce the configured Origin/Fetch Metadata checks. Keep CSRF tokens out of URLs, logs, and persistent browser storage. A token from another session is rejected. The CORS policy allows credentials only for exact `CORS_ALLOWED_ORIGINS` entries, never a wildcard.

Helmet supplies security headers (HSTS only in production). JSON and URL-encoded request bodies default to 16 KiB; configure `REQUEST_BODY_LIMIT_BYTES` within 1 KiB–1 MiB if needed. Unknown JSON fields are rejected. Request logs contain a generated request ID, method, route template, status, duration, and actor ID when authenticated, but not URLs with query strings, bodies, cookies, tokens, or idempotency keys. Error responses do not include internal stacks or database errors. Swagger UI is available only outside production; its `csrf-token` header scheme documents protected writes.

The API limits general traffic to 600 requests/minute per IP, login/registration to 30/minute per IP plus 10 attempts/five minutes per normalized account, refresh to 60/minute per IP, transfer submission to 120/minute per IP, and admin routes to 60/minute per IP. These are **process-local** limits; they do not coordinate across multiple API instances. Deploy with one API instance until a compatible shared throttling store (for example Redis) and trusted proxy/IP configuration are added. Reverse-proxy, TLS, key management, and traffic/load validation remain deployment responsibilities.

## Transfers and authorization

`POST /api/v1/transfers` requires an active CUSTOMER session, `Idempotency-Key`, and a JSON body with `sourceWalletId`, `destinationWalletId`, and positive `amountMinor` string (kobo). The source wallet's `userId` and active account status are checked inside the financial transaction. `X-Simulated-Actor` is ignored and grants no authority. `GET /api/v1/transfers` returns up to 100 outgoing transfers from the customer's wallets; OPERATIONS/ADMIN can read recent transfers for investigation but cannot submit transfers.

Reuse the same key and request to retrieve the original result, including after an API restart. Reusing a key with another amount or wallet returns HTTP 409. Keys are scoped to the authenticated customer. Failed transfers roll back their key reservation, so the same request can be retried. The historical simulated transfer flow remains only in financial regression tests and internal services, not the public controller.

`GET /api/v1/audit-events?limit=50` is restricted to OPERATIONS/ADMIN and returns up to 100 recent audit events. ADMIN can also list users at `GET /api/v1/admin/users`, and change another account's role or status at `PATCH /api/v1/admin/users/:id/role` (`{ "role": "OPERATIONS" }`) or `PATCH /api/v1/admin/users/:id/status` (`{ "status": "SUSPENDED" }`). These actions are audited. Self-role/status changes are forbidden; the last active administrator cannot be demoted or suspended. Suspending a user revokes their sessions and refresh tokens. The first admin must be provisioned through a controlled, out-of-band process; there is no public bootstrap or self-promotion endpoint.

## Audit API and financial checks

Audit events include a safe actor identifier, event type, related resource, outcome, timestamp, and limited metadata. The API provides no audit update or delete route, and PostgreSQL rejects updates, deletes, and truncation.

Run `npm run ledger:verify` to check that every posted journal has at least two entries with a zero sum and matching currencies, and that wallet balance projections match their posted ledger entries. The command prints a JSON report and exits with code 1 if it finds discrepancies. It never changes balances.

Swagger UI at `/docs` in development/test lists REST routes, cookie authentication, CSRF-protected writes, request bodies, and response codes. Missing authentication returns 401; insufficient role or ownership returns 403. Wallet creation and transfer submission return 201, invalid requests return 400, missing wallets return 404, and insufficient funds or idempotency conflicts return 409.

## Quality commands

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:concurrency
npm run test:cov
npm run db:validate
npm run db:status
npm run ledger:verify
```

Run `npm run format` to apply Prettier formatting.

Integration and concurrency tests require `INTEGRATION_DATABASE_URL` to reference a dedicated database named `ledgerflow_phase1f_integration_*` with the committed migrations applied. This historical test-database prefix is retained across later suites. The Phase 2F integration suite also requires local Redis (`npm run redis:up`) and creates persistent test jobs. The auth/authorization suite generates an ephemeral signing key in memory. Historical Phase 1 simulation HTTP tests use test-only controllers; production routes require authenticated identity. For the default local PostgreSQL container:

```bash
docker exec ledgerflow-database-1 createdb -U ledgerflow ledgerflow_phase1f_integration_local
export INTEGRATION_DATABASE_URL='postgresql://ledgerflow:ledgerflow_dev_password@127.0.0.1:5432/ledgerflow_phase1f_integration_local?schema=public'
DATABASE_URL="$INTEGRATION_DATABASE_URL" npm run db:migrate:deploy
npm run test:integration
npm run test:concurrency
DATABASE_URL="$INTEGRATION_DATABASE_URL" npm run ledger:verify
```

The concurrency harness runs ten rounds each of identical-key requests and competing debits. Set `CONCURRENCY_ROUNDS=20 npm run test:concurrency` to run a different number between 1 and 50. The database name guard prevents tests from writing to the primary development database. These tests create disposable records; use a fresh integration database for a clean run.

Database changes must be committed as Prisma migrations. Create a development migration with:

```bash
npm run db:migrate -- --name describe_the_change
```

Use `npm run db:migrate:deploy` to apply committed migrations in non-development environments. Do not use `prisma db push` as a replacement for migrations. Stop the local database with `npm run db:down`; its named volume is retained.

## Project structure

```text
ledgerflow/
├── apps/
│   ├── api/       # NestJS modular-monolith backend
│   └── web/       # Next.js design system and placeholder application shells
├── docs/           # Architecture and data-model documentation
├── compose.yaml    # Loopback-only local PostgreSQL and Redis
├── .env.example
└── package.json   # Workspace scripts
```

Within `apps/api/src`, `auth/` and `security/` own sessions and CSRF,
`access-control/` owns RBAC and admin actions, `wallets/`, `ledger/`, and
`transfers/` own financial workflows, `outbox/` and `background/` own durable
delivery and recovery, `audit/` and `integrity/` provide verification, and
`health/` provides API liveness/readiness. `main-dispatcher.ts` and
`main-worker.ts` are separate process entry points.

The API includes application configuration, shared HTTP exception handling, health, wallet management, an internal ledger service, a global Prisma module, Phase 2A identity ownership, Phase 2B authentication/session services, and Phase 2C role/resource authorization. The financial schema and its source-of-truth and immutability rules are documented in [docs/financial-data-model.md](docs/financial-data-model.md).

Phase 2E adds a [transactional outbox](docs/transactional-outbox.md): completed transfers persist one minimal, versioned event atomically with their ledger and audit writes. Phase 2F adds a separate [BullMQ dispatcher and worker](docs/phase2f-background-workers.md) that turn committed events into deduplicated internal notification records. Phase 2G adds bounded retries, durable [failure recovery](docs/phase2g-failure-recovery.md), and protected operations endpoints. Phase 2H adds [verification and observability](docs/phase2h-verification.md), with a [Phase 3 API contract](docs/frontend-integration-contract.md). Phase 3A adds a [frontend setup check](docs/phase3a-frontend-setup.md); Phase 3B adds a [responsive design system and route shells](docs/phase3b-design-system.md). Neither phase integrates live account or financial data. No real SMS/email provider is included.

The transfer engine uses deterministic PostgreSQL row locks and one interactive transaction for every financial write. The Phase 1E API reserves a database unique `(scope, key)` row and completes that row and the transfer in the same transaction. Concurrent duplicate requests wait for the first transaction and replay its saved result; no in-memory lock or cache is used.

Phase 1F records successful operations atomically with their financial writes and records rejected transfers separately. `AuditEvent` rows are append-only. The integrity command provides an independent check of posted journal and wallet projection invariants.

Current limits: historical provisional wallets remain suspended and unclaimable through the API, funding is seed-only, and inspection endpoints return at most 100 rows. There are no real payment rails, frontend application features, or deployment features. Before production browser use, provide a verified enrollment path for provisional users, controlled initial-admin provisioning, audit retention, and load testing under expected traffic. Multiple API instances additionally need shared rate-limit storage.
