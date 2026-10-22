CREATE TYPE "audit_outcome" AS ENUM ('succeeded', 'rejected');

ALTER TABLE "audit_events"
    ADD COLUMN "outcome" "audit_outcome" NOT NULL DEFAULT 'succeeded';

CREATE TRIGGER "audit_events_append_only_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "prevent_audit_event_mutation"();
