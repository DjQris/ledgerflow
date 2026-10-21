# Financial data model

LedgerFlow uses a double-entry ledger. All monetary values are stored in signed PostgreSQL `BIGINT` columns as minor units (called kobo in the phase brief); no floating-point values are permitted.

## Money convention

- Application code represents database amounts as JavaScript `bigint`.
- API and JSON boundaries must parse and serialize amounts as canonical base-10 integer strings, using `parseMinorUnits` and `serializeMinorUnits`.
- JSON numbers, decimal strings, exponential notation, and values outside PostgreSQL's signed 64-bit range are rejected.
- A transfer's `amountMinor` is positive. Ledger-entry `amountMinor` values are explicitly signed: credits and debits use opposing signs and a posted journal must sum to zero.

## Models and relationships

- `Wallet` represents a single-currency customer balance container. It has exactly one wallet-type `LedgerAccount` once provisioned.
- `LedgerAccount` holds the cached balance for a wallet or represents a system account. The seeded `SYSTEM_FUNDING_CLEARING_KES` account is the counterparty for simulated opening funds.
- `LedgerTransaction` is the journal header. It owns two or more `LedgerEntry` postings and can point to the original journal when it is a reversal.
- `LedgerEntry` is a signed posting to one ledger account. Entries belonging to a posted journal must sum to zero and use the journal currency.
- `Transfer` links source and destination wallets to its journal and optional idempotency record.
- `IdempotencyRecord` uniquely owns a `(scope, key)` pair and stores the request hash and replayable outcome.
- `AuditEvent` is an append-only record of important entity activity.

## Source of truth and immutability

`LedgerEntry` rows in posted `LedgerTransaction` journals are the financial source of truth. `LedgerAccount.cachedBalanceMinor` is a cache derived by a database trigger when a journal becomes posted; it must not be treated as an independent financial fact.

Posted journals and their entries are immutable. Corrections require a new zero-sum reversal journal linked through `reversalOfId`. Audit events are always immutable. Wallets, transfers, idempotency records, pending journals, and cached account balances are operational records and may change according to their lifecycle.

Database triggers reject unbalanced, single-entry, or cross-currency journals when they are posted. They also prevent inserting, updating, or deleting entries in a posted journal.
