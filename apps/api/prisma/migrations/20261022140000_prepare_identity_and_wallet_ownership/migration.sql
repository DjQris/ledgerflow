-- Phase 2A creates provisional identities without credentials. Stop the old
-- application while this transactional backfill runs: subsequent wallet writes
-- require the new user_id column.
BEGIN;

CREATE TYPE "user_role" AS ENUM ('customer', 'operations', 'admin');
CREATE TYPE "user_status" AS ENUM ('active', 'suspended');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255),
    "role" "user_role" NOT NULL DEFAULT 'customer',
    "status" "user_status" NOT NULL DEFAULT 'suspended',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_normalized_check" CHECK (
        "email" = lower(btrim("email")) AND "email" ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    )
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_role_idx" ON "users"("status", "role");

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_sessions_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE INDEX "auth_sessions_user_id_revoked_at_expires_at_idx"
    ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parent_token_id" UUID,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "refresh_tokens_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE UNIQUE INDEX "refresh_tokens_parent_token_id_key" ON "refresh_tokens"("parent_token_id");
CREATE INDEX "refresh_tokens_session_id_revoked_at_expires_at_idx"
    ON "refresh_tokens"("session_id", "revoked_at", "expires_at");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_parent_token_id_fkey"
    FOREIGN KEY ("parent_token_id") REFERENCES "refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallets" ADD COLUMN "user_id" UUID;

-- UUID-derived .invalid addresses cannot collide or receive mail. Keeping the
-- user's ID equal to the pre-existing wallet ID makes the backfill deterministic
-- without changing wallet, ledger, transfer, or audit identifiers.
INSERT INTO "users" ("id", "email", "role", "status", "created_at", "updated_at")
SELECT "id", 'simulated-' || "id"::text || '@ledgerflow.invalid',
       'customer', 'suspended', "created_at", "created_at"
FROM "wallets";

UPDATE "wallets" SET "user_id" = "id" WHERE "user_id" IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "wallets" WHERE "user_id" IS NULL) THEN
        RAISE EXCEPTION 'Wallet ownership backfill is incomplete';
    END IF;
END $$;

ALTER TABLE "wallets" ALTER COLUMN "user_id" SET NOT NULL;
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
