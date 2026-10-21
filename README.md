# LedgerFlow

LedgerFlow is an npm-workspace monorepo. It currently provides a NestJS API and a PostgreSQL/Prisma persistence layer; `apps/web` is reserved for a future Next.js application and is not scaffolded yet.

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
npm install
npm run db:up
npm run db:migrate
npm run db:generate
npm run db:seed
```

The defaults in `.env.example` are safe for local development. Keep real secrets in `.env`; local environment files are ignored by Git.

`db:up` starts PostgreSQL 18 on `127.0.0.1:5432`, backed by a persistent Docker volume. Confirm it is healthy with `docker compose ps`.

`db:seed` is restricted to local and test environments. It creates the simulated `test-ada` and `test-tobi` NGN wallets and posts balanced development opening-funding journals. It is safe to rerun: stable owner and external references prevent duplicate wallets or opening balances.

## Start the API

```bash
npm run start:dev
```

The development server exposes:

- Health check: <http://localhost:3000/api/v1/health>
- Swagger UI: <http://localhost:3000/docs>

For a production-style local run:

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

## Quality commands

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:cov
npm run db:validate
npm run db:status
```

Run `npm run format` to apply Prettier formatting.

The transfer integration suite requires `INTEGRATION_DATABASE_URL` to reference a dedicated database named `ledgerflow_phase1d_integration_*` with the committed migrations applied. This safeguard prevents the suite from writing test records to the development database.

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

The API includes application configuration, shared HTTP exception handling, health, wallet management, an internal ledger service, and a global Prisma module. The financial schema and its source-of-truth and immutability rules are documented in [docs/financial-data-model.md](docs/financial-data-model.md).

The internal transfer engine uses deterministic PostgreSQL row locks and one interactive transaction for every financial write. It is intentionally not exposed through an HTTP controller; the public endpoint and idempotency layer remain future work.

Authentication, Redis, real-money integrations, public funding operations, and frontend features remain outside the current phase.
