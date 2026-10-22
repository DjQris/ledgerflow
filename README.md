# LedgerFlow

LedgerFlow is an npm-workspace monorepo containing a NestJS API and a PostgreSQL/Prisma ledger. `apps/web` is reserved for a future application and is not scaffolded. See the [architecture diagram](docs/architecture.md) and [financial data model](docs/financial-data-model.md).

The stack is TypeScript, NestJS, PostgreSQL 18, Prisma, Jest, and Supertest. Swagger documents the HTTP API.

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
npm run db:migrate:deploy
npm run db:generate
npm run db:seed
```

The defaults in `.env.example` are safe for local development. Keep real secrets in `.env`; local environment files are ignored by Git.

`db:up` starts PostgreSQL 18 on `127.0.0.1:5432`, backed by a persistent Docker volume. Confirm it is healthy with `docker compose ps`.

`db:seed` is restricted to local and test environments. It creates the simulated `test-ada` and `test-tobi` NGN wallets and posts balanced development opening-funding journals. It is safe to rerun: stable owner and external references prevent duplicate wallets or opening balances.

Phase 2A also creates a suspended, passwordless provisional `User` for each seeded or newly simulated wallet. No development login password is shipped or required.

## Start the API

```bash
npm run start:dev
```

The development server exposes:

- Health check: <http://localhost:3000/api/v1/health>
- Swagger UI: <http://localhost:3000/docs>

For a compiled local run:

```bash
npm run build
npm run start:prod
```

## Wallet API

Phase 1C exposes wallet management under `/api/v1/wallets`:

- `POST /api/v1/wallets` creates a zero-balance NGN wallet for a simulated `test-*` owner reference.
- `GET /api/v1/wallets` lists wallets.
- `GET /api/v1/wallets/:id` returns one wallet and its ledger-backed balance projection.
- `GET /api/v1/wallets/:id/transactions?page=1&pageSize=20` returns paginated posted transaction history.

There is intentionally no public funding endpoint. Development opening balances are created only by `npm run db:seed` as balanced ledger journals.

## Phase 2A identity preparation

The database now contains `User`, `AuthSession`, and `RefreshToken` models. Every wallet has a required `userId` foreign key. Existing wallet IDs, balances, journals, transfers, and audit events are preserved. The migration creates one provisional customer user per existing wallet, using the wallet UUID as the user UUID and a unique `simulated-<wallet-uuid>@ledgerflow.invalid` address. These users are suspended and have `passwordHash = NULL`; they cannot be used to sign in. New simulated wallets provision the same kind of user in the wallet-creation transaction. The legacy `ownerReference` remains for Phase 1 API compatibility.

`auth/`, `access-control/`, and `security/` are module boundaries only. There are no authentication endpoints, sessions in use, access tokens, role guards, or changes to transfer authorization yet. `.env.example` reserves future authentication settings but includes no signing key or user passwords. Do not activate or reuse provisional identities without an explicit enrollment and credential-setting flow in a later phase.

For an existing database, take a recoverable backup, stop the old API, run `npm run db:migrate:deploy`, regenerate Prisma Client, then start the updated API. The Phase 2A migration runs in a PostgreSQL transaction, backfills all existing wallets, verifies ownership is complete, and only then sets `wallets.user_id` to `NOT NULL` and adds its foreign key. Old API instances cannot create wallets after the new constraint is in place, so do not run old and new versions together during this migration. See [the identity migration notes](docs/phase2a-identity-migration.md) for verification queries and compatibility risks.

## Local transfer simulation

Phase 1E exposes transfer simulation only to loopback clients while `NODE_ENV` is `development` or `test`:

- `POST /api/v1/transfers` requires `Idempotency-Key` and `X-Simulated-Actor` headers. The actor is the source wallet's `test-*` owner reference. The JSON body contains `sourceWalletId`, `destinationWalletId`, and a positive `amountMinor` string (kobo). Success returns HTTP 201 and the completed transfer result.
- `GET /api/v1/transfers/` requires `X-Simulated-Actor` and returns up to 100 recent outgoing transfers for that actor.

Reuse the same key and request to retrieve the original result, including after an API restart. Reusing a key with another amount or wallet returns HTTP 409. Different actors have separate key scopes. Failed transfers roll back their key reservation, so the same request can be retried. These endpoints use simulated ownership only; Phase 2 will introduce authentication.

## Audit API and financial checks

`GET /api/v1/audit-events?limit=50` returns up to 100 recent audit events. Like the transfer endpoints, it accepts only loopback requests in development or test mode. Events include a safe actor identifier, event type, related resource, outcome, timestamp, and limited metadata. The API provides no audit update or delete route, and PostgreSQL rejects updates, deletes, and truncation.

Run `npm run ledger:verify` to check that every posted journal has at least two entries with a zero sum and matching currencies, and that wallet balance projections match their posted ledger entries. The command prints a JSON report and exits with code 1 if it finds discrepancies. It never changes balances.

Swagger UI at `/docs` lists all REST routes, headers, request bodies, and response codes. Wallet creation returns 201, reads return 200, and transfer submission returns 201. Invalid requests return 400, missing wallets return 404, insufficient funds or idempotency conflicts return 409, and routes restricted to local development return 403.

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

Integration and concurrency tests require `INTEGRATION_DATABASE_URL` to reference a dedicated database named `ledgerflow_phase1f_integration_*` with the committed migrations applied. This historical test-database prefix is retained for all Phase 1 and 2A suites. For the default local PostgreSQL container:

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
│   └── web/       # Reserved for the future Next.js application
├── docs/           # Architecture and data-model documentation
├── compose.yaml    # Loopback-only local PostgreSQL
├── .env.example
└── package.json   # Workspace scripts
```

The API includes application configuration, shared HTTP exception handling, health, wallet management, an internal ledger service, a global Prisma module, and the Phase 2A `users/`, `auth/`, `access-control/`, and `security/` modules. The financial schema and its source-of-truth and immutability rules are documented in [docs/financial-data-model.md](docs/financial-data-model.md).

The transfer engine uses deterministic PostgreSQL row locks and one interactive transaction for every financial write. The Phase 1E API reserves a database unique `(scope, key)` row and completes that row and the transfer in the same transaction. Concurrent duplicate requests wait for the first transaction and replay its saved result; no in-memory lock or cache is used.

Phase 1F records successful operations atomically with their financial writes and records rejected transfers separately. `AuditEvent` rows are append-only. The integrity command provides an independent check of posted journal and wallet projection invariants.

Current limits: actors are simulated, transfers and audit inspection work only locally, funding is seed-only, and inspection endpoints return at most 100 rows. There are no real payment rails, active authentication, frontend, or deployment features. Before activating authentication, design secure registration or migration of provisional identities, password hashing, session and refresh-token rotation, role enforcement, and audit retention; also load-test the transaction path under expected traffic.
