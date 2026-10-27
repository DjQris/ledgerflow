# Phase 3 frontend integration contract

This documents the HTTP API used by the Phase 3C Next.js client. The base path is
`/api/v1`. In development, Swagger
is available at `/docs`; it is disabled in production. All IDs are UUIDs and
dates are ISO 8601 strings. Monetary `*Minor` fields are decimal **strings**
of kobo, never JavaScript numbers or floating-point currency values.

## Browser session and CSRF

Use `credentials: 'include'` on requests. Login and refresh set HTTP-only,
host-only access and refresh cookies (with `Secure` and `__Host-` prefixes over
HTTPS). JavaScript does not read the cookies. The API returns an in-memory
session-bound CSRF token in the `X-CSRF-Token` response header after login or
refresh, or in `{ "csrfToken": "..." }` from authenticated
`GET /auth/csrf`. Send it as `X-CSRF-Token` on all authenticated POST/PATCH/
PUT/DELETE requests, including refresh and logout. Refresh rotates the token;
replace the client's in-memory value. Do not put it in a URL or persistent
browser storage. Browser writes must originate from the exact configured
`AUTH_ALLOWED_ORIGIN`; CORS permits credentials only for configured origins.
When the access cookie has expired but the refresh cookie is still active,
`GET /auth/refresh-csrf` returns `{ "csrfToken": "..." }` so a same-origin BFF
can perform a CSRF-protected refresh. It does not rotate or extend the session.

The Next.js app uses a same-origin, auth-only BFF under `/api/auth/*` and a
separate customer-read BFF under `/api/customer/*`. Configure
its server-only `API_BASE_URL` (default `http://localhost:3000/api/v1`) and
serve it on port 3001 in development. The BFF validates browser `Origin` on
every write, forwards only named auth operations and the two expected host-only
HTTP-only cookies, gets a fresh CSRF token server-to-server for refresh/logout,
and copies validated `Set-Cookie` headers onto its own response. Never put
`API_BASE_URL` or signing/session secrets in a `NEXT_PUBLIC_` variable. In
production the web origin must be HTTPS so the backend's `Secure`/`__Host-`
cookies retain their attributes. Route protection checks `/auth/me` on the
server; a 401 with a refresh cookie leads to a one-shot renewal page. Browser
query caches hold only the public profile in memory and are cleared on logout.
Because the API sees BFF requests from the same server address, its IP bucket
uses the global 600/minute ceiling for login and registration; the separate
account bucket remains 10 attempts per email per five minutes. Production
deployments should also apply per-client-IP limits at the trusted web ingress;
the BFF must not trust an arbitrary client-supplied forwarding header.

| Route                    | Request                        | Success                                            | Notes                                                                                |
| ------------------------ | ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /auth/register`    | `{email,password}`             | 201, `{id,email,role,status}`                      | CUSTOMER only; no session created.                                                   |
| `POST /auth/login`       | `{email,password}`             | 200, profile plus cookies and CSRF response header | Generic 401 for unknown, wrong-password, or suspended accounts.                      |
| `GET /auth/me`           | Access cookie                  | 200, profile                                       | 401 if expired/revoked/suspended.                                                    |
| `GET /auth/csrf`         | Access cookie                  | 200, `{csrfToken}`                                 | For reloads while a session is still valid.                                          |
| `GET /auth/refresh-csrf` | Active, unused refresh cookie  | 200, `{csrfToken}`                                 | For BFF refresh after access expiry; 401 for missing/used/revoked/suspended session. |
| `POST /auth/refresh`     | Refresh cookie and CSRF header | 204, new cookies and CSRF response header          | Reuse revokes the session; 401 on invalid token.                                     |
| `POST /auth/logout`      | Cookies and CSRF header        | 204, cleared cookies                               | Revokes the database session.                                                        |

Passwords must have at least 12 characters and fit within bcrypt's 72-byte
UTF-8 limit at the API boundary. The browser must
not store or display raw tokens, password hashes, or internal account fields.
Retrying a 401 refresh indefinitely is unsafe; return to sign-in if refresh
fails. Handle 403 as permission/CSRF failure, not as an invitation to refresh.

## Customer financial routes

| Route                                                                                                | Success                                | Access and limits                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /wallets` with `{}`                                                                            | 201, wallet                            | CUSTOMER, CSRF; one wallet per customer.                                                 |
| `GET /wallets`                                                                                       | 200, wallet array                      | CUSTOMER sees own wallets; staff see all.                                                |
| `GET /wallets/:id`                                                                                   | 200, wallet                            | CUSTOMER must own it.                                                                    |
| `GET /wallets/:id/transactions?page=1&pageSize=20&reference=&from=&to=&status=&direction=&sort=desc` | 200, `{data,pagination}`               | CUSTOMER must own it; page >= 1, pageSize 1–100. Filters are applied server-side.        |
| `GET /transactions/:id`                                                                              | 200, customer-safe transaction details | CUSTOMER role only; returns 404 for missing and non-owned transactions.                  |
| `POST /transfers`                                                                                    | 201, transfer result                   | CUSTOMER, CSRF, `Idempotency-Key` header.                                                |
| `GET /transfers`                                                                                     | 200, transfer array                    | CUSTOMER's outgoing transfers; staff investigation read. Maximum 100, no pagination yet. |

A wallet has `id`, `ownerReference`, `currency` (`NGN`), `status`,
`balanceMinor`, `createdAt`, and `updatedAt`. Transaction-history `data` rows
include `id`, `transactionId`, `type`, `status`, `amountMinor`, `description`,
`externalReference`, `createdAt`, and nullable `postedAt`. The customer
dashboard contract also includes `direction` (`INCOMING`, `OUTGOING`, or
`NEUTRAL`, derived from the signed ledger amount) and nullable
`counterpartyWalletId` (derived from the transfer's source/destination wallet
IDs; no counterparty profile data is exposed). `pagination` has `page`,
`pageSize`, `total`, and `totalPages`. Transfer rows report persisted transfer
status; other rows report ledger status. Failed attempts that rolled back and
have no persisted transaction do not appear in history. Transaction details
never expose ledger entries or private audit metadata.

The browser reads wallet data and submits transfers through fixed same-origin routes
`GET /api/customer/wallets` and
`GET /api/customer/wallets/:id/transactions` with pagination and optional
reference/date/status/direction/sort filters. The BFF checks
the authenticated role is CUSTOMER before forwarding, validates the wallet ID
and supported pagination/filter fields, and returns only the documented fields. The NestJS API still
performs wallet ownership checks; the BFF role gate is also necessary because
staff wallet list permissions are broader.

The customer transfer form submits through `POST /api/customer/transfers` with
only `{sourceWalletId,destinationWalletId,amountMinor}` and a UUID
`Idempotency-Key`. This BFF checks the request Origin and customer role, obtains
the session-bound CSRF token server-side, forwards the token only to NestJS,
and returns a strict allowlist of the transfer result. CSRF tokens and raw
backend error envelopes are never returned to the browser. No description
field is supported by the transfer API.

If a submission times out or returns an ambiguous server/conflict response,
the result is unknown rather than failed. Preserve the exact request and key
in tab-scoped session storage (no credentials or CSRF token), then verify by
repeating that exact POST with the same key. The backend replays a completed
result for that key and payload. Never retry the same intent with a new key or
automatically create a second transfer. Only a confirmed 201 response
invalidates wallet and transaction queries; balances are not optimistically
updated.

To submit a transfer, send `{sourceWalletId,destinationWalletId,amountMinor}`
with a positive canonical integer string amount, for example `"1250"`. The
source must be the signed-in customer's active wallet. Generate one UUID
`Idempotency-Key` for the intended transfer and retain it while retrying that
same request after a network timeout. The same key and payload replay the
original result; the same key with a different payload returns 409. A 201
result includes `transferId`, `journalId`, `status`, `completedAt`, both wallet
IDs, `amountMinor`, `sourceBalanceMinor`, and `destinationBalanceMinor`.
There is no public funding endpoint.

## Staff routes and permissions

| Route                                                    | OPERATIONS         | ADMIN              |
| -------------------------------------------------------- | ------------------ | ------------------ |
| `GET /audit-events?limit=50`                             | Read               | Read               |
| `GET /ops/outbox?limit=50`                               | Read               | Read               |
| `GET /ops/jobs/failed?limit=50` and `GET /ops/jobs/:id`  | Read               | Read               |
| `POST /ops/jobs/:id/retry` with CSRF                     | Retry eligible job | Retry eligible job |
| `GET /admin/users`                                       | Denied             | Read               |
| `PATCH /admin/users/:id/role` with `{role}` and CSRF     | Denied             | Update             |
| `PATCH /admin/users/:id/status` with `{status}` and CSRF | Denied             | Update             |

Staff cannot submit customer transfers. All `limit` queries default to 50 and
are capped at 100; user and transfer lists currently cap at 100 without a
pagination contract. The audit list returns action, actor/resource identifiers,
outcome, timestamp, and safe metadata. Failed-job results include event/job IDs,
source, category, fixed reason code, cumulative attempts, failure timestamps,
status, and retry actor; the outbox list exposes metadata, not event payloads.
The retry route returns a status such as `queued`, `queued_for_dispatch`, or
`already_processed`, or 409 if the event is not eligible. The first admin is
provisioned out of band; there is no public bootstrap route.

## Errors and operational status

Errors use `{statusCode,timestamp,path,method,message,error}`; `message` may
be a string or validation-message array. `path` is a route template, not a URL
with query values. Typical statuses are 400 (invalid input), 401 (missing or
invalid session), 403 (role/ownership/origin/CSRF), 404 (unknown resource),
409 (idempotency or business conflict), 429 (throttled), 500 (unexpected
failure), and 503 (unavailable dependency). `X-Request-Id` helps correlate
safe API logs. Do not display raw backend error details to customers.

`GET /health` is API liveness; `GET /health/ready` is PostgreSQL readiness
(200/503). Redis failure does not make the financial API unready, but staff
manual retry may return 503 and background delivery may lag. The worker and
dispatcher have separate loopback probes described in [operations](operations.md).
The browser should surface a pending/retry state after uncertain transfer
network outcomes and retry with the **same** idempotency key, not create a new
transfer. There is no public push-notification, payment-rail, or real email/SMS
contract yet.
