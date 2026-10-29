# Phase 4B — API/client contract matrix

Generated from the backend OpenAPI document produced by Nest Swagger decorators and the checked-in frontend mapping at `apps/web/api-contract-map.json`. The API's Swagger annotations are authoritative; do not add speculative paths here. Regenerate with `npm run phase4:openapi` followed by `node scripts/phase4/render-contract-matrix.mjs`.

| Method | Versioned API path | Frontend client source | Same-origin browser BFF | Auth / write protection | Contract notes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | apps/web/src/lib/auth/bff.ts | POST /api/auth/register | public + same-origin | Creates a customer account; never accepts a role. |
| POST | `/api/v1/auth/login` | apps/web/src/lib/auth/bff.ts | POST /api/auth/login | public + same-origin | Sets HTTP-only session cookies; CSRF token stays server-side. |
| POST | `/api/v1/auth/refresh` | apps/web/src/lib/auth/bff.ts | POST /api/auth/refresh | refresh cookie + CSRF + same-origin | Rotates refresh token; BFF obtains refresh CSRF token. |
| POST | `/api/v1/auth/logout` | apps/web/src/lib/auth/bff.ts | POST /api/auth/logout | session/refresh cookie + CSRF + same-origin | Revokes active session and clears cookies. |
| GET | `/api/v1/auth/me` | apps/web/src/lib/auth/backend.ts | server session lookup | access cookie | Profile is parsed and role/status constrained before use. |
| GET | `/api/v1/auth/csrf` | apps/web/src/lib/auth/bff.ts; apps/web/src/lib/customer/transfer-bff.ts; apps/web/src/lib/operations/center-bff.ts; apps/web/src/lib/operations/bff.ts | internal only | access cookie | CSRF token is never exposed to browser JavaScript. |
| GET | `/api/v1/auth/refresh-csrf` | apps/web/src/lib/auth/bff.ts | internal only | refresh cookie | Used only when logout has an expired access token. |
| GET | `/api/v1/health` | — | — | public | Operational health endpoint; no browser consumer. |
| GET | `/api/v1/health/ready` | apps/web/src/lib/operations/bff.ts | internal only | public | Operations metrics page adds readiness status. |
| GET | `/api/v1/admin/users` | — | — | admin cookie | API list operation has no current frontend consumer. |
| GET | `/api/v1/admin/users/search` | apps/web/src/lib/operations/bff.ts | GET /api/operations/users | admin cookie | Paginated user search; BFF validates pagination and response fields. |
| GET | `/api/v1/admin/users/{id}` | apps/web/src/lib/operations/bff.ts | GET /api/operations/users/{userId} | admin cookie | Administrator-only detail view. |
| PATCH | `/api/v1/admin/users/{id}/role` | apps/web/src/lib/operations/bff.ts | PATCH /api/operations/users/{userId}/role | admin cookie + CSRF | Role changes are validated by API and BFF. |
| PATCH | `/api/v1/admin/users/{id}/status` | apps/web/src/lib/operations/bff.ts | PATCH /api/operations/users/{userId}/status | admin cookie + CSRF | Status changes are validated by API and BFF. |
| GET | `/api/v1/audit-events` | — | — | operations/admin cookie | Unfiltered API listing is not used by the frontend. |
| GET | `/api/v1/audit-events/search` | apps/web/src/lib/operations/center-bff.ts | GET /api/operations/audit | operations/admin cookie | Paginated, allowlisted audit-event view; sensitive metadata is stripped. |
| GET | `/api/v1/operations/metrics` | apps/web/src/lib/operations/bff.ts | GET /api/operations/metrics | operations/admin cookie | Monetary totals are serialized as integer minor-unit strings. |
| GET | `/api/v1/ops/jobs/failed` | apps/web/src/lib/operations/center-bff.ts | GET /api/operations/jobs | operations/admin cookie | BFF validates each failure record and filters safe fields. |
| GET | `/api/v1/ops/jobs/{id}` | apps/web/src/lib/operations/center-bff.ts | GET /api/operations/jobs/{jobId} | operations/admin cookie | Job detail is read-only and validated by the BFF. |
| POST | `/api/v1/ops/jobs/{id}/retry` | apps/web/src/lib/operations/center-bff.ts | POST /api/operations/jobs/{jobId}/retry | operations/admin cookie + CSRF | Retry is audited, idempotent, and only forwarded after same-origin validation. |
| GET | `/api/v1/ops/outbox` | — | — | operations/admin cookie | API diagnostics endpoint has no current frontend consumer. |
| GET | `/api/v1/ops/reconciliation` | apps/web/src/lib/operations/center-bff.ts | GET /api/operations/reconciliation | operations/admin cookie | Read-only integrity report; no correction action is exposed. |
| GET | `/api/v1/transactions/{id}` | apps/web/src/lib/customer/bff.ts | GET /api/customer/transactions/{transactionId} | customer cookie + owner check | BFF returns only customer-safe detail fields. |
| POST | `/api/v1/transfers` | apps/web/src/lib/customer/transfer-bff.ts | POST /api/customer/transfers | customer cookie + CSRF + same-origin + Idempotency-Key | Exact integer minor units; retries preserve the original idempotency key. |
| GET | `/api/v1/transfers` | — | — | customer/staff role | Inspection endpoint has no current frontend consumer. |
| POST | `/api/v1/wallets` | — | — | customer cookie + CSRF | Wallet creation is API-only; customer UI does not expose a create action. |
| POST | `/api/v1/wallets/simulated` | — | — | admin cookie + local simulation guard + CSRF | Local-only provisional simulation endpoint; never used in browser journeys. |
| GET | `/api/v1/wallets` | apps/web/src/lib/customer/bff.ts | GET /api/customer/wallets | customer cookie | BFF enforces CUSTOMER role and validates exact decimal-string balance. |
| GET | `/api/v1/wallets/{id}` | — | — | customer/staff cookie + ownership policy | Individual API lookup is not currently used by frontend. |
| GET | `/api/v1/wallets/{id}/transactions` | apps/web/src/lib/customer/bff.ts | GET /api/customer/wallets/{walletId}/transactions | customer cookie + ownership policy | BFF validates pagination and signed integer minor-unit strings. |
