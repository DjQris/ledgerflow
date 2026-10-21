-- CreateEnum
CREATE TYPE "wallet_status" AS ENUM ('active', 'frozen', 'closed');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('wallet', 'system_clearing');

-- CreateEnum
CREATE TYPE "ledger_transaction_type" AS ENUM ('opening_funding', 'transfer', 'adjustment', 'reversal');

-- CreateEnum
CREATE TYPE "ledger_transaction_status" AS ENUM ('pending', 'posted', 'voided');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('pending', 'completed', 'failed', 'reversed');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "wallet_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "wallet_id" UUID,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "cached_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "type" "ledger_transaction_type" NOT NULL,
    "status" "ledger_transaction_status" NOT NULL DEFAULT 'pending',
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(500),
    "external_reference" VARCHAR(255),
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMPTZ(6),

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "source_wallet_id" UUID NOT NULL,
    "destination_wallet_id" UUID NOT NULL,
    "ledger_transaction_id" UUID,
    "idempotency_record_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "transfer_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'processing',
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "actor_type" VARCHAR(100),
    "actor_id" VARCHAR(255),
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallets_status_idx" ON "wallets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_wallet_id_key" ON "ledger_accounts"("wallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_currency_idx" ON "ledger_accounts"("type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_external_reference_key" ON "ledger_transactions"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reversal_of_id_key" ON "ledger_transactions"("reversal_of_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_status_created_at_idx" ON "ledger_transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "ledger_transactions_type_created_at_idx" ON "ledger_transactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_ledger_transaction_id_key" ON "transfers"("ledger_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_idempotency_record_id_key" ON "transfers"("idempotency_record_id");

-- CreateIndex
CREATE INDEX "transfers_status_created_at_idx" ON "transfers"("status", "created_at");

-- CreateIndex
CREATE INDEX "transfers_source_wallet_id_created_at_idx" ON "transfers"("source_wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_destination_wallet_id_created_at_idx" ON "transfers"("destination_wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_status_created_at_idx" ON "idempotency_records"("status", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_occurred_at_idx" ON "audit_events"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_wallet_id_fkey" FOREIGN KEY ("source_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_wallet_id_fkey" FOREIGN KEY ("destination_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_idempotency_record_id_fkey" FOREIGN KEY ("idempotency_record_id") REFERENCES "idempotency_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial data integrity constraints not expressible in the Prisma schema.
ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "ledger_accounts"
    ADD CONSTRAINT "ledger_accounts_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "ledger_accounts_wallet_type_check"
    CHECK (
        ("type" = 'wallet' AND "wallet_id" IS NOT NULL)
        OR ("type" = 'system_clearing' AND "wallet_id" IS NULL)
    );

ALTER TABLE "ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "ledger_transactions_reversal_check"
    CHECK (("type" = 'reversal') = ("reversal_of_id" IS NOT NULL)),
    ADD CONSTRAINT "ledger_transactions_posted_at_check"
    CHECK (("status" = 'posted') = ("posted_at" IS NOT NULL));

ALTER TABLE "ledger_entries"
    ADD CONSTRAINT "ledger_entries_amount_nonzero_check"
    CHECK ("amount_minor" <> 0);

ALTER TABLE "transfers"
    ADD CONSTRAINT "transfers_amount_positive_check"
    CHECK ("amount_minor" > 0),
    ADD CONSTRAINT "transfers_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "transfers_distinct_wallets_check"
    CHECK ("source_wallet_id" <> "destination_wallet_id"),
    ADD CONSTRAINT "transfers_completed_journal_check"
    CHECK (
        "status" <> 'completed'
        OR ("ledger_transaction_id" IS NOT NULL AND "completed_at" IS NOT NULL)
    );

ALTER TABLE "idempotency_records"
    ADD CONSTRAINT "idempotency_records_response_status_check"
    CHECK (
        "response_status" IS NULL
        OR "response_status" BETWEEN 100 AND 599
    );

-- Posted journals and their entries are immutable. A journal may only become
-- posted after it has at least two same-currency entries whose signed amounts
-- sum to zero.
CREATE FUNCTION "enforce_ledger_transaction_integrity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    entry_count BIGINT;
    entry_total NUMERIC;
    cross_currency_count BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" = 'posted' THEN
            RAISE EXCEPTION 'Posted ledger transactions are immutable';
        END IF;

        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."status" = 'posted' THEN
        RAISE EXCEPTION 'Posted ledger transactions are immutable';
    END IF;

    IF NEW."status" = 'posted' THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'Ledger transactions must be populated before posting';
        END IF;

        SELECT
            COUNT(*),
            COALESCE(SUM(entry."amount_minor"), 0),
            COUNT(*) FILTER (WHERE account."currency" <> NEW."currency")
        INTO entry_count, entry_total, cross_currency_count
        FROM "ledger_entries" AS entry
        JOIN "ledger_accounts" AS account ON account."id" = entry."account_id"
        WHERE entry."transaction_id" = NEW."id";

        IF entry_count < 2 THEN
            RAISE EXCEPTION 'A posted ledger transaction requires at least two entries';
        END IF;

        IF entry_total <> 0 THEN
            RAISE EXCEPTION 'A posted ledger transaction must have a zero-sum balance';
        END IF;

        IF cross_currency_count <> 0 THEN
            RAISE EXCEPTION 'Every ledger entry account must match the transaction currency';
        END IF;

        NEW."posted_at" := COALESCE(NEW."posted_at", CURRENT_TIMESTAMP);
    ELSE
        NEW."posted_at" := NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_transactions_integrity_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "ledger_transactions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_ledger_transaction_integrity"();

CREATE FUNCTION "enforce_ledger_entry_mutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    journal_id UUID;
    journal_status "ledger_transaction_status";
BEGIN
    IF TG_OP = 'DELETE' THEN
        journal_id := OLD."transaction_id";
    ELSE
        journal_id := NEW."transaction_id";
    END IF;

    SELECT "status"
    INTO journal_status
    FROM "ledger_transactions"
    WHERE "id" = journal_id;

    IF journal_status = 'posted' THEN
        RAISE EXCEPTION 'Entries in a posted ledger transaction are immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_entries_mutability_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION "enforce_ledger_entry_mutability"();

-- The entry rows remain the source of truth. This trigger maintains the account
-- balance cache atomically when a validated journal becomes posted.
CREATE FUNCTION "update_ledger_account_balance_cache"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE "ledger_accounts" AS account
    SET
        "cached_balance_minor" = account."cached_balance_minor" + totals."amount_minor",
        "updated_at" = CURRENT_TIMESTAMP
    FROM (
        SELECT "account_id", SUM("amount_minor") AS "amount_minor"
        FROM "ledger_entries"
        WHERE "transaction_id" = NEW."id"
        GROUP BY "account_id"
    ) AS totals
    WHERE account."id" = totals."account_id";

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_transactions_balance_cache_trigger"
AFTER UPDATE OF "status" ON "ledger_transactions"
FOR EACH ROW
WHEN (OLD."status" <> 'posted' AND NEW."status" = 'posted')
EXECUTE FUNCTION "update_ledger_account_balance_cache"();

CREATE FUNCTION "prevent_audit_event_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are immutable';
END;
$$;

CREATE TRIGGER "audit_events_immutable_trigger"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "prevent_audit_event_mutation"();

-- Deterministic simulated counterparty for balanced KES opening funds.
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
    '00000000-0000-4000-8000-000000000001',
    NULL,
    'SYSTEM_FUNDING_CLEARING_KES',
    'Simulated KES Funding and Clearing',
    'system_clearing',
    'KES',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
