import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClassifiedFailure } from './failure-classification';
import { ClaimedOutboxEvent } from '../outbox/outbox.service';

export interface FailedJobRecord {
  id: string;
  eventId: string;
  jobId: string;
  source: 'dispatcher' | 'worker';
  failureCategory: 'temporary' | 'permanent';
  failureReason: string;
  attempts: number;
  firstFailureAt: Date;
  lastFailureAt: Date;
  status: 'retrying' | 'dead_letter' | 'retry_pending' | 'resolved';
  retryActorId: string | null;
}

const SAFE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function safeJobId(value: unknown): string {
  if (
    typeof value === 'string' &&
    (SAFE_ID.test(value) || /^invalid-[0-9a-f]{32}$/.test(value))
  )
    return value;
  const digest = createHash('sha256').update(String(value)).digest('hex');
  return `invalid-${digest.slice(0, 32)}`;
}

@Injectable()
export class FailureService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    eventId: string;
    jobId: string;
    source: 'dispatcher' | 'worker';
    failure: ClassifiedFailure;
    attempts: number;
    exhausted: boolean;
  }): Promise<void> {
    const eventId = safeJobId(input.eventId);
    const jobId = safeJobId(input.jobId);
    const status =
      input.exhausted || input.failure.category === 'permanent'
        ? 'dead_letter'
        : 'retrying';
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "failed_background_jobs" (
        "event_id", "job_id", "source", "failure_category",
        "failure_reason", "attempts", "run_attempts", "status"
      ) VALUES (
        ${eventId}, ${jobId}, ${input.source}, ${input.failure.category},
        ${input.failure.reason}, ${Math.max(1, input.attempts)},
        ${Math.max(1, input.attempts)}, ${status}
      )
      ON CONFLICT ("source", "job_id") DO UPDATE SET
        "failure_category" = EXCLUDED."failure_category",
        "failure_reason" = EXCLUDED."failure_reason",
        "attempts" = "failed_background_jobs"."attempts" +
          GREATEST(0, EXCLUDED."run_attempts" - "failed_background_jobs"."run_attempts"),
        "run_attempts" = GREATEST("failed_background_jobs"."run_attempts", EXCLUDED."run_attempts"),
        "last_failure_at" = CURRENT_TIMESTAMP,
        "status" = CASE
          WHEN "failed_background_jobs"."status" = 'resolved' THEN 'resolved'
          ELSE EXCLUDED."status" END,
        "updated_at" = CURRENT_TIMESTAMP
    `);
  }

  async quarantineDispatch(
    claim: ClaimedOutboxEvent,
    reason: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        UPDATE "outbox_events" SET "status" = 'dead_letter',
          "last_error" = ${reason}, "lease_owner" = NULL,
          "lease_token" = NULL, "lease_expires_at" = NULL
        WHERE "id" = ${claim.id}::uuid AND "status" = 'claimed'
          AND "lease_owner" = ${claim.leaseOwner}
          AND "lease_token" = ${claim.leaseToken}::uuid
          AND "lease_expires_at" > CURRENT_TIMESTAMP
        RETURNING "id"
      `);
      if (!rows.length) return false;
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "failed_background_jobs" (
          "event_id", "job_id", "source", "failure_category",
          "failure_reason", "attempts", "run_attempts", "status"
        ) VALUES (
          ${claim.id}, ${claim.id}, 'dispatcher', 'permanent',
          ${reason}, ${claim.attempts}, ${claim.attempts}, 'dead_letter'
        )
        ON CONFLICT ("source", "job_id") DO UPDATE SET
          "failure_category" = 'permanent', "failure_reason" = EXCLUDED."failure_reason",
          "attempts" = "failed_background_jobs"."attempts" +
            GREATEST(0, EXCLUDED."run_attempts" - "failed_background_jobs"."run_attempts"),
          "run_attempts" = GREATEST("failed_background_jobs"."run_attempts", EXCLUDED."run_attempts"),
          "last_failure_at" = CURRENT_TIMESTAMP, "status" = 'dead_letter',
          "updated_at" = CURRENT_TIMESTAMP
      `);
      return true;
    });
  }

  async resolve(jobId: string, source: 'dispatcher' | 'worker'): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "failed_background_jobs" SET "status" = 'resolved',
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "job_id" = ${safeJobId(jobId)} AND "source" = ${source}
    `);
  }

  async getByJob(
    source: 'dispatcher' | 'worker',
    jobId: string,
  ): Promise<FailedJobRecord | null> {
    const rows = await this.prisma.$queryRaw<FailedJobRecord[]>(Prisma.sql`
      SELECT "id", "event_id" AS "eventId", "job_id" AS "jobId",
        "source", "failure_category" AS "failureCategory",
        "failure_reason" AS "failureReason", "attempts",
        "first_failure_at" AS "firstFailureAt",
        "last_failure_at" AS "lastFailureAt", "status",
        "retry_actor_id" AS "retryActorId"
      FROM "failed_background_jobs" WHERE "job_id" = ${jobId} AND "source" = ${source}
    `);
    return rows[0] ?? null;
  }

  async getById(id: string): Promise<FailedJobRecord | null> {
    const rows = await this.prisma.$queryRaw<FailedJobRecord[]>(Prisma.sql`
      SELECT "id", "event_id" AS "eventId", "job_id" AS "jobId",
        "source", "failure_category" AS "failureCategory",
        "failure_reason" AS "failureReason", "attempts",
        "first_failure_at" AS "firstFailureAt",
        "last_failure_at" AS "lastFailureAt", "status",
        "retry_actor_id" AS "retryActorId"
      FROM "failed_background_jobs" WHERE "id" = ${id}::uuid
    `);
    return rows[0] ?? null;
  }

  async listFailed(limit = 50): Promise<FailedJobRecord[]> {
    return this.prisma.$queryRaw<FailedJobRecord[]>(Prisma.sql`
      SELECT "id", "event_id" AS "eventId", "job_id" AS "jobId",
        "source", "failure_category" AS "failureCategory",
        "failure_reason" AS "failureReason", "attempts",
        "first_failure_at" AS "firstFailureAt",
        "last_failure_at" AS "lastFailureAt", "status",
        "retry_actor_id" AS "retryActorId"
      FROM "failed_background_jobs" WHERE "status" = 'dead_letter'
      ORDER BY "last_failure_at" DESC, "id" DESC LIMIT ${limit}
    `);
  }

  async listOutbox(limit = 50): Promise<
    Array<{
      id: string;
      eventType: string;
      status: string;
      attempts: number;
      createdAt: Date;
      nextAttemptAt: Date;
      lastError: string | null;
    }>
  > {
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT "id", "event_type" AS "eventType", "status"::text AS "status",
        "attempts", "created_at" AS "createdAt",
        "next_attempt_at" AS "nextAttemptAt", "last_error" AS "lastError"
      FROM "outbox_events" ORDER BY "created_at" DESC, "id" DESC LIMIT ${limit}
    `);
  }
}
