ALTER TYPE "outbox_status" ADD VALUE 'dead_letter';

ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_lease_check";
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_lease_check" CHECK (
    ("status" = 'claimed' AND "lease_owner" IS NOT NULL
      AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL
      AND "published_at" IS NULL)
    OR ("status" = 'pending' AND "lease_owner" IS NULL
      AND "lease_token" IS NULL AND "lease_expires_at" IS NULL
      AND "published_at" IS NULL)
    OR ("status" = 'published' AND "lease_owner" IS NULL
      AND "lease_token" IS NULL AND "lease_expires_at" IS NULL
      AND "published_at" IS NOT NULL)
    OR ("status"::text = 'dead_letter' AND "lease_owner" IS NULL
      AND "lease_token" IS NULL AND "lease_expires_at" IS NULL
      AND "published_at" IS NULL)
);

CREATE TABLE "failed_background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" VARCHAR(100) NOT NULL,
    "job_id" VARCHAR(150) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "failure_category" VARCHAR(20) NOT NULL,
    "failure_reason" VARCHAR(100) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "run_attempts" INTEGER NOT NULL DEFAULT 0,
    "first_failure_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_failure_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL,
    "retry_actor_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "failed_background_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "failed_background_jobs_source_check" CHECK ("source" IN ('dispatcher', 'worker')),
    CONSTRAINT "failed_background_jobs_category_check" CHECK ("failure_category" IN ('temporary', 'permanent')),
    CONSTRAINT "failed_background_jobs_status_check" CHECK ("status" IN ('retrying', 'dead_letter', 'retry_pending', 'resolved')),
    CONSTRAINT "failed_background_jobs_attempts_check" CHECK ("attempts" >= 1),
    CONSTRAINT "failed_background_jobs_run_attempts_check" CHECK ("run_attempts" >= 0)
);

CREATE UNIQUE INDEX "failed_background_jobs_source_job_id_key"
    ON "failed_background_jobs"("source", "job_id");
CREATE INDEX "failed_background_jobs_status_last_failure_at_idx"
    ON "failed_background_jobs"("status", "last_failure_at");
CREATE INDEX "failed_background_jobs_event_id_idx"
    ON "failed_background_jobs"("event_id");
