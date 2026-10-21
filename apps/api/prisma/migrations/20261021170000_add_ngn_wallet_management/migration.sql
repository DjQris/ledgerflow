-- Phase 1C uses stable simulated owner identifiers instead of customer data.
ALTER TABLE "wallets"
    ADD COLUMN "owner_reference" VARCHAR(100);

-- Phase 1B exposed no wallet creation API. This backfill keeps the migration
-- deterministic if a developer created local rows directly before Phase 1C.
UPDATE "wallets"
SET "owner_reference" = 'test-legacy-' || "id"::text
WHERE "owner_reference" IS NULL;

ALTER TABLE "wallets"
    ALTER COLUMN "owner_reference" SET NOT NULL,
    ALTER COLUMN "currency" SET DEFAULT 'NGN',
    ADD CONSTRAINT "wallets_ngn_currency_check" CHECK ("currency" = 'NGN');

CREATE UNIQUE INDEX "wallets_owner_reference_key"
ON "wallets"("owner_reference");

-- Wallet-backed accounts must use the wallet currency required by this phase.
-- The existing KES system account remains valid because it is not wallet-backed.
ALTER TABLE "ledger_accounts"
    ADD CONSTRAINT "ledger_accounts_wallet_ngn_currency_check"
    CHECK ("type" <> 'wallet' OR "currency" = 'NGN');

-- Deterministic simulated counterparty for balanced NGN development funding.
INSERT INTO "ledger_accounts" (
    "id",
    "wallet_id",
    "code",
    "name",
    "type",
    "currency",
    "cached_balance_minor",
    "created_at",
    "updated_at"
)
VALUES (
    '00000000-0000-4000-8000-000000000002',
    NULL,
    'SYSTEM_FUNDING_CLEARING_NGN',
    'Simulated NGN Funding and Clearing',
    'system_clearing',
    'NGN',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
