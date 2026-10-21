# LedgerFlow

LedgerFlow is an npm-workspace monorepo. Phase 1A provides the NestJS API scaffold; `apps/web` is reserved for a future Next.js application and is not scaffolded yet.

## Prerequisites

- Node.js 24 LTS (Node.js 22 or newer is supported)
- npm 10 or newer
- Git

PostgreSQL and Docker Compose configuration will be added in Phase 1B. They are not required for this phase.

## Installation

```bash
git clone <repository-url> ledgerflow
cd ledgerflow
cp .env.example .env
npm install
```

The defaults in `.env.example` are safe for local development. Keep real secrets in `.env`; local environment files are ignored by Git.

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

## Quality commands

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:cov
```

Run `npm run format` to apply Prettier formatting.

## Project structure

```text
ledgerflow/
├── apps/
│   ├── api/       # NestJS modular-monolith backend
│   └── web/       # Reserved for the future Next.js application
├── .env.example
└── package.json   # Workspace scripts
```

The API currently contains only application configuration, shared HTTP exception handling, and the health module. Database access, wallets, transaction services, authentication, Redis, and frontend features are intentionally outside Phase 1A.
