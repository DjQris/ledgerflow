CREATE TYPE "outbox_status" AS ENUM ('pending', 'claimed', 'published');

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "event_version" INTEGER NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(100),
    "lease_owner" VARCHAR(100),
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_version_check" CHECK ("event_version" > 0),
    CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "outbox_events_lease_check" CHECK (
        ("status" = 'claimed' AND "lease_owner" IS NOT NULL
          AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL
          AND "published_at" IS NULL)
        OR ("status" = 'pending' AND "lease_owner" IS NULL
          AND "lease_token" IS NULL AND "lease_expires_at" IS NULL
          AND "published_at" IS NULL)
        OR ("status" = 'published' AND "lease_owner" IS NULL
          AND "lease_token" IS NULL AND "lease_expires_at" IS NULL
          AND "published_at" IS NOT NULL)
    )
);

CREATE INDEX "outbox_events_status_next_attempt_at_created_at_idx"
    ON "outbox_events"("status", "next_attempt_at", "created_at");
CREATE INDEX "outbox_events_status_lease_expires_at_idx"
    ON "outbox_events"("status", "lease_expires_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx"
    ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "outbox_events_pending_discovery_idx"
    ON "outbox_events"("next_attempt_at", "created_at", "id")
    WHERE "status" = 'pending';
CREATE UNIQUE INDEX "outbox_events_transfer_completed_once_idx"
    ON "outbox_events"("aggregate_id")
    WHERE "event_type" = 'transfer.completed';
