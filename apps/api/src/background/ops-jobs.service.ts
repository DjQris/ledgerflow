import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { EnvironmentVariables } from '../config/environment';
import { Prisma } from '../generated/prisma/client';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { parseTransferCompletedPayload } from '../outbox/outbox-events';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnection } from './background-environment';
import { FailedJobRecord, FailureService } from './failure.service';
import { OpsJobQueryDto } from './ops-job-query.dto';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface EventForRetry {
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  status: string;
  transferStatus: string | null;
}

@Injectable()
export class OpsJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly failures: FailureService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  listFailed(query: OpsJobQueryDto): Promise<FailedJobRecord[]> {
    return this.failures.listFailed(query);
  }

  async get(id: string): Promise<FailedJobRecord> {
    const record = await this.failures.getById(id);
    if (!record) throw new NotFoundException('Failed job not found');
    return record;
  }

  listOutbox(limit: number): ReturnType<FailureService['listOutbox']> {
    return this.failures.listOutbox(limit);
  }

  async retry(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ status: string; jobId: string }> {
    const decision = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<FailedJobRecord[]>(Prisma.sql`
        SELECT "id", "event_id" AS "eventId", "job_id" AS "jobId",
          "source", "failure_category" AS "failureCategory",
          "failure_reason" AS "failureReason", "attempts",
          "first_failure_at" AS "firstFailureAt", "last_failure_at" AS "lastFailureAt",
          "status", "retry_actor_id" AS "retryActorId"
        FROM "failed_background_jobs" WHERE "id" = ${id}::uuid FOR UPDATE
      `);
      const record = rows[0];
      if (!record) return { status: 'not_found' as const, jobId: '' };

      const currentActor = await transaction.user.findUnique({
        where: { id: actor.id },
        select: { role: true, status: true },
      });
      if (
        !currentActor ||
        currentActor.status !== UserStatus.ACTIVE ||
        (currentActor.role !== UserRole.OPERATIONS &&
          currentActor.role !== UserRole.ADMIN)
      ) {
        await this.audit.recordRejectedInTransaction(transaction, {
          action: 'background_retry_denied',
          actorType: 'user',
          actorId: actor.id,
          entityType: 'failed_background_job',
          entityId: id,
          metadata: { reason: 'ROLE_DENIED' },
        });
        return { status: 'forbidden' as const, jobId: record.jobId };
      }

      if (UUID_PATTERN.test(record.eventId)) {
        const processed = await transaction.$queryRaw<
          Array<{ id: string }>
        >(Prisma.sql`
          SELECT "id" FROM "processed_events" WHERE "id" = ${record.eventId}::uuid
        `);
        if (processed.length) {
          await transaction.$executeRaw(Prisma.sql`
            UPDATE "failed_background_jobs" SET "status" = 'resolved',
              "retry_actor_id" = ${actor.id}::uuid, "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${id}::uuid
          `);
          await this.audit.recordSucceeded(transaction, {
            action: 'background_retry_already_processed',
            actorType: 'user',
            actorId: actor.id,
            entityType: 'failed_background_job',
            entityId: id,
            metadata: { eventId: record.eventId },
          });
          return { status: 'already_processed' as const, jobId: record.jobId };
        }
      }

      const resuming = record.status === 'retry_pending';
      if (
        (record.status !== 'dead_letter' && !resuming) ||
        !UUID_PATTERN.test(record.eventId)
      ) {
        await this.audit.recordRejectedInTransaction(transaction, {
          action: 'background_retry_denied',
          actorType: 'user',
          actorId: actor.id,
          entityType: 'failed_background_job',
          entityId: id,
          metadata: { reason: 'NOT_ELIGIBLE' },
        });
        return { status: 'not_eligible' as const, jobId: record.jobId };
      }

      const events = await transaction.$queryRaw<EventForRetry[]>(Prisma.sql`
        SELECT event."aggregate_id" AS "aggregateId",
          event."aggregate_type" AS "aggregateType",
          event."event_type" AS "eventType",
          event."event_version" AS "eventVersion", event."payload",
          event."status"::text AS "status",
          transfer."status"::text AS "transferStatus"
        FROM "outbox_events" AS event
        LEFT JOIN "transfers" AS transfer ON transfer."id" = event."aggregate_id"
        WHERE event."id" = ${record.eventId}::uuid
      `);
      const event = events[0];
      let valid = Boolean(
        event &&
        event.eventType === 'transfer.completed' &&
        event.aggregateType === 'transfer' &&
        event.eventVersion === 1 &&
        event.transferStatus === 'completed' &&
        record.jobId === record.eventId &&
        (record.source !== 'worker' || event.status === 'published'),
      );
      if (valid) {
        try {
          const payload = parseTransferCompletedPayload(event.payload);
          valid =
            payload.eventId === record.eventId &&
            payload.transferId === event.aggregateId;
        } catch {
          valid = false;
        }
      }
      if (
        !valid ||
        (record.source === 'dispatcher' &&
          event.status !== (resuming ? 'pending' : 'dead_letter'))
      ) {
        await this.audit.recordRejectedInTransaction(transaction, {
          action: 'background_retry_denied',
          actorType: 'user',
          actorId: actor.id,
          entityType: 'failed_background_job',
          entityId: id,
          metadata: { reason: 'EVENT_NOT_READY' },
        });
        return { status: 'not_eligible' as const, jobId: record.jobId };
      }

      if (resuming) {
        await this.audit.recordSucceeded(transaction, {
          action: 'background_retry_resumed',
          actorType: 'user',
          actorId: actor.id,
          entityType: 'failed_background_job',
          entityId: id,
          metadata: { eventId: record.eventId, source: record.source },
        });
        return {
          status:
            record.source === 'dispatcher'
              ? 'queued_for_dispatch'
              : 'enqueue_worker',
          jobId: record.jobId,
        };
      }

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "failed_background_jobs" SET "status" = 'retry_pending',
          "retry_actor_id" = ${actor.id}::uuid,
          "run_attempts" = CASE WHEN "source" = 'worker' THEN 0 ELSE "run_attempts" END,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid
      `);
      if (record.source === 'dispatcher') {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "outbox_events" SET "status" = 'pending',
            "next_attempt_at" = CURRENT_TIMESTAMP, "last_error" = NULL
          WHERE "id" = ${record.eventId}::uuid AND "status" = 'dead_letter'
        `);
      }
      await this.audit.recordSucceeded(transaction, {
        action: 'background_retry_requested',
        actorType: 'user',
        actorId: actor.id,
        entityType: 'failed_background_job',
        entityId: id,
        metadata: { eventId: record.eventId, source: record.source },
      });
      return {
        status:
          record.source === 'dispatcher'
            ? 'queued_for_dispatch'
            : 'enqueue_worker',
        jobId: record.jobId,
      };
    });

    if (decision.status === 'not_found')
      throw new NotFoundException('Failed job not found');
    if (decision.status === 'forbidden')
      throw new ForbiddenException('Access denied');
    if (decision.status === 'not_eligible')
      throw new ConflictException('Job is not eligible for retry');
    if (decision.status !== 'enqueue_worker') return decision;

    const queue = new Queue(TRANSFER_EVENTS_QUEUE, {
      connection: redisConnection(
        this.config.get('REDIS_URL', { infer: true }),
        'dispatcher',
        this.config.get('REDIS_CONNECT_TIMEOUT_MS', { infer: true }),
      ),
      defaultJobOptions: {
        attempts: this.config.get('BACKGROUND_JOB_MAX_ATTEMPTS', {
          infer: true,
        }),
        backoff: {
          type: 'exponential',
          delay: this.config.get('BACKGROUND_RETRY_DELAY_MS', { infer: true }),
          jitter: 0.5,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
    queue.on('error', () => undefined);
    try {
      const job = await queue.getJob(decision.jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'failed') {
          const data: unknown = job.data;
          const matchesEvent =
            typeof data === 'object' &&
            data !== null &&
            'eventId' in data &&
            data.eventId === decision.jobId;
          if (job.name !== 'transfer.completed' || !matchesEvent) {
            await job.remove();
            await queue.add(
              'transfer.completed',
              { eventId: decision.jobId },
              { jobId: decision.jobId },
            );
          } else {
            await job.retry('failed', {
              resetAttemptsMade: true,
              resetAttemptsStarted: true,
            });
          }
        } else if (
          !['waiting', 'delayed', 'active', 'waiting-children'].includes(state)
        ) {
          throw new ConflictException('Job is not in a retryable state');
        }
      } else {
        await queue.add(
          'transfer.completed',
          { eventId: decision.jobId },
          { jobId: decision.jobId },
        );
      }
      return { status: 'queued', jobId: decision.jobId };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // A response can fail after another caller has already moved the stable
      // job ID to the queue. Do not turn a durable retry intent back into a
      // dead letter or report a false outage in that case.
      try {
        const current = await queue.getJob(decision.jobId);
        const data: unknown = current?.data;
        const canonical =
          current?.name === 'transfer.completed' &&
          typeof data === 'object' &&
          data !== null &&
          'eventId' in data &&
          data.eventId === decision.jobId;
        if (
          canonical &&
          current &&
          ['waiting', 'delayed', 'active', 'waiting-children'].includes(
            await current.getState(),
          )
        ) {
          return { status: 'queued', jobId: decision.jobId };
        }
      } catch {
        // Keep retry_pending so a later authorized call can resume the handoff.
      }
      throw new ServiceUnavailableException(
        'Queue unavailable; retry remains pending',
      );
    } finally {
      await queue.close();
    }
  }
}
