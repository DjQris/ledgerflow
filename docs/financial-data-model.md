# Financial data model

LedgerFlow uses a double-entry ledger. All monetary values are stored in signed PostgreSQL `BIGINT` columns as minor units (called kobo in the phase brief); no floating-point values are permitted.

## Money convention

- Application code represents database amounts as JavaScript `bigint`.
- API and JSON boundaries must parse and serialize amounts as canonical base-10 integer strings, using `parseMinorUnits` and `serializeMinorUnits`.
- JSON numbers, decimal strings, exponential notation, and values outside PostgreSQL's signed 64-bit range are rejected.
- A transfer's `amountMinor` is positive. Ledger-entry `amountMinor` values are explicitly signed: credits and debits use opposing signs and a posted journal must sum to zero.

## Models and relationships

- `User` is the security principal with a normalized unique email, role, status, and optional password hash. New self-registered customers are active; migrated and newly simulated users remain suspended with no password.
- `Wallet` represents an NGN balance container for a simulated owner reference. It has a required `User` owner and exactly one wallet-type `LedgerAccount` once provisioned. The owner reference remains for Phase 1 API compatibility.
- `AuthSession` references a user, and `RefreshToken` references a session. An opaque token stores only a 64-character lowercase SHA-256 hash and may point to one parent token for rotation. Session revocation invalidates access and all refresh tokens immediately; refresh-token reuse revokes the affected session.
- `LedgerAccount` holds the cached balance for a wallet or represents a system account. The seeded `SYSTEM_FUNDING_CLEARING_NGN` account is the counterparty for simulated development opening funds; the Phase 1B KES system account remains available for historical compatibility.
- `LedgerTransaction` is the journal header. It owns two or more `LedgerEntry` postings and can point to the original journal when it is a reversal.
- `LedgerEntry` is a signed posting to one ledger account. Entries belonging to a posted journal must sum to zero and use the journal currency.
- `Transfer` links source and destination wallets to its journal and optional idempotency record.
- `IdempotencyRecord` uniquely owns a `(scope, key)` pair and stores the request hash and replayable outcome.
- `AuditEvent` is an append-only record of important entity activity with an explicit succeeded or rejected outcome. It stores a safe actor identifier, action, resource type and ID, timestamp, and limited metadata.
- `OutboxEvent` stores a minimal, versioned `transfer.completed` payload committed with the financial transaction. A stable event UUID becomes the BullMQ job ID.
- `ProcessedEvent` reserves that UUID in the worker transaction; `TransactionNotification` references the event, transfer, and recipient user. The reservation and notification commit together, so duplicate deliveries cannot duplicate the side effect.
- `FailedBackgroundJob` records sanitized dispatcher/worker failures and cumulative attempts for inspection and audited recovery. It is not a financial posting and never triggers a transfer retry.

## Source of truth and immutability

`LedgerEntry` rows in posted `LedgerTransaction` journals are the financial source of truth. `LedgerAccount.cachedBalanceMinor` is a cache derived by a database trigger when a journal becomes posted; it must not be treated as an independent financial fact.

Application and direct SQL updates to `cachedBalanceMinor` are rejected by a database trigger. Only the nested journal-posting trigger may change this projection. Wallet transfers lock both participating wallet/account rows in deterministic UUID order, recheck the source balance under lock, and create the transfer, journal, postings, projection updates, and completion state in one database transaction.

Phase 1E scopes each idempotency key to the simulated source owner and transfer operation. The request hash covers canonical wallet UUIDs and amount in minor units. The existing unique `(scope, key)` constraint coordinates concurrent inserts in PostgreSQL. The idempotency row, saved HTTP result, transfer, and journal commit together; failure rolls all of them back. Completed duplicate requests return the saved result without another ledger write.

Posted journals and their entries are immutable. Corrections require a new zero-sum reversal journal linked through `reversalOfId`. Audit event updates, deletes, and truncation are blocked by PostgreSQL triggers. Wallets, transfers, idempotency records, pending journals, and cached account balances are operational records and may change according to their lifecycle.

Database triggers reject unbalanced, single-entry, or cross-currency journals when they are posted. They also prevent inserting, updating, or deleting entries in a posted journal.
