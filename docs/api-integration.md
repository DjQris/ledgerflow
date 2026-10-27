# Frontend/API integration contract

The browser communicates only with same-origin Next.js BFF endpoints. The
server-side `API_BASE_URL` points to the NestJS API and must not use a
`NEXT_PUBLIC_` prefix. Keep it free of embedded credentials. The BFF forwards
the allowlisted session cookies to the backend, sets `cache: 'no-store'`, and
does not return backend cookies, CSRF tokens, or internal error details to the
browser.

## Authentication and access

The UI uses `/api/auth/register`, `/api/auth/login`, `/api/auth/me`,
`/api/auth/refresh`, and `/api/auth/logout`. Browser cookies are HTTP-only;
authenticated writes use same-origin checks and session-bound CSRF tokens
forwarded server-to-server. Role and status are checked both at server-rendered
route boundaries and at each BFF/API request. A suspended, expired, or revoked
session is not treated as an active profile. UI hiding is not authorization.

## Customer data

| Browser BFF route                                  | Operation                                         | Client behavior                                                                              |
| -------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/customer/wallets`                        | List current customer's wallets                   | Render integer minor-unit balances; no local balance authority.                              |
| `GET /api/customer/wallets/:walletId/transactions` | Bounded, filtered history                         | Render backend pagination and transaction status.                                            |
| `GET /api/customer/transactions/:transactionId`    | Customer-safe transaction detail                  | Do not expose ledger entries or private audit metadata.                                      |
| `POST /api/customer/transfers`                     | Submit exact transfer intent with idempotency key | Same-origin, customer role, server-side CSRF; retry ambiguous outcome with same key/payload. |

The API validates ownership, active account status, self-transfer, funds,
idempotency, and ledger posting. The browser parses NGN into canonical integer
kobo strings and formats with `BigInt`. No public funding endpoint exists.
Failed submissions do not cause optimistic balance changes. On a confirmed
success, wallet and transaction query keys are invalidated.

## Operations and administration

The operations BFF surfaces metrics, failed job list/detail/retry, audit search,
and read-only ledger reconciliation. OPERATIONS and ADMIN may use operations
routes; only ADMIN may list/inspect users and change user role/status. Backend
policies are the authority. Retry is protected by CSRF and confirmation and
requeues an existing notification event only. Audit and reconciliation remain
read-only, bounded where applicable, and allowlisted before display. The
reconciliation report checks internal ledger consistency; it is not settlement
comparison and never repairs data.

## Safe QA prerequisites

Database-backed integration tests require `INTEGRATION_DATABASE_URL` to point
to a dedicated database whose name begins `ledgerflow_phase1f_integration_`;
the test harness rejects other names. The Phase 2F/2G background suites also
require isolated Redis. Use a fresh local test database and test-only accounts
with simulated opening balances. Never point these tests at a production or
shared operational database. Full frontend journeys must use the same isolated
test stack and must clean up created users, wallets, transfer records, and job
state according to the test fixture's documented lifecycle.

In the Phase 3I execution environment, `DATABASE_URL`,
`INTEGRATION_DATABASE_URL`, and `REDIS_URL` were unset, and the Docker daemon
socket was unavailable. Therefore no database-backed customer transfer or
operations journey was claimed as executed. Existing API integration suites
remain the source of truth for real PostgreSQL behavior; rerun them in an
isolated environment before release.
