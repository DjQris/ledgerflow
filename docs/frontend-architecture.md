# Frontend architecture

LedgerFlow's web application lives in `apps/web` and uses Next.js App Router,
React, TypeScript, and TanStack Query. It is a browser UI for the existing API;
it is not a separate financial authority. The backend remains responsible for
identity, role/ownership checks, transfer validation, idempotency, and ledger
writes.

## Route and component layout

- Public routes: `/login`, `/register`, and the development-only `/design-system`.
- Customer routes: `/dashboard`, `/wallets`, `/transfer`, `/transactions`, and
  `/transactions/[transactionId]`.
- Operations routes: `/operations`, `/operations/transactions`, `/operations/jobs`,
  `/operations/jobs/[jobId]`, `/operations/audit`, and
  `/operations/reconciliation`.
- Administrator routes: `/operations/users` and `/operations/users/[userId]`.

The shared `(app)` layout verifies the server-side session before rendering the
application shell. Route-level `requireRole` checks restrict customer and staff
pages. Layout checks are a UI boundary only; every BFF request and API endpoint
performs its own authorization. `AppShell` supplies the role-filtered desktop
sidebar, mobile navigation, top bar, and user menu. Shared components under
`src/components` own data panels, loading/error/empty states, money display,
confirmation dialogs, status badges, and the local Button.

## Request and state flow

Browser components call same-origin `/api/...` routes. Next.js route handlers
delegate to BFF functions in `src/lib`; server-side backend calls use the
server-only `API_BASE_URL` setting. The BFF forwards only supported fields,
checks session/role and same-origin requirements for writes, obtains CSRF
tokens server-side, applies response allowlists, uses `no-store`, and maps
backend failures to safe client messages. Access/refresh cookies and CSRF tokens
are not exposed to client JavaScript.

TanStack Query owns remote read state and bounded freshness/refetch behavior.
Private query data is cleared on logout, on a 401 from the current-session
check, and before caching a newly authenticated profile so a second account
cannot inherit the previous account's private UI cache. Successful mutations
invalidate affected queries. Transfers do not optimistically change balances:
only a backend-confirmed result invalidates wallet/history queries. An ambiguous
transfer preserves its exact request and idempotency key
in tab-scoped `sessionStorage`, scoped to the current user. That record contains
no credentials or CSRF token and is retried only as the same intent. Theme
preference is a non-sensitive local UI preference and may use `localStorage`.

## Financial and operational boundaries

Amounts cross the API/BFF as canonical integer minor-unit strings. Formatting
and parsing use `BigInt`; do not convert money to JavaScript floating point.
Wallet balances, transfer results, transaction history, metrics, audit events,
failed jobs, and reconciliation reports are rendered from validated backend
responses. The UI has no ledger mutation, balance editing, funding, audit edit,
or reconciliation repair capability. Retry applies only to the existing
notification event and never resubmits a transfer.

## Verification and support

Run web typecheck, lint, unit tests, money tests, a Webpack production build,
and `npm run verify:ui --workspace @ledgerflow/web`. The browser verifier checks
public authentication screens at 360, 390, 768, 1024, and 1440 CSS pixels and
can smoke-test authenticated workspace routes when a dedicated QA access cookie
and role are supplied. It does not manufacture test identity or funds. Database-backed
journeys require the dedicated integration database described in
[`api-integration.md`](api-integration.md); no production environment should be
used for QA.

The workspace intentionally uses the committed PanelUI package exports and
design tokens. `apps/web/AGENTS.md` contains the repository-specific Next.js
version rule: consult the installed Next.js docs before changing Next APIs or
conventions.
