CREATE TYPE "notification_status" AS ENUM ('recorded');

CREATE TABLE "processed_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "processed_events_processed_at_idx"
    ON "processed_events"("processed_at");

CREATE TABLE "transaction_notifications" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'recorded',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transaction_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_notifications_event_type_check"
      CHECK ("event_type" = 'transfer.completed')
);

CREATE UNIQUE INDEX "transaction_notifications_event_id_key"
    ON "transaction_notifications"("event_id");
CREATE INDEX "transaction_notifications_recipient_user_id_created_at_idx"
    ON "transaction_notifications"("recipient_user_id", "created_at");
CREATE INDEX "transaction_notifications_transfer_id_idx"
    ON "transaction_notifications"("transfer_id");

ALTER TABLE "transaction_notifications"
    ADD CONSTRAINT "transaction_notifications_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "processed_events"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transaction_notifications"
    ADD CONSTRAINT "transaction_notifications_recipient_user_id_fkey"
    FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transaction_notifications"
    ADD CONSTRAINT "transaction_notifications_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
