import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { OutboxService } from '../outbox/outbox.service';
import { TRANSFER_COMPLETED_TYPE } from '../outbox/outbox-events';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';
import { classifyFailure, PermanentJobError } from './failure-classification';
import { FailureService } from './failure.service';

export interface DispatchSummary {
  claimed: number;
  published: number;
  retried: number;
}

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);
  private readonly owner = `dispatcher-${randomUUID()}`;
  private stopping = false;

  constructor(
    private readonly outbox: OutboxService,
    @InjectQueue(TRANSFER_EVENTS_QUEUE) private readonly queue: Queue,
    private readonly failures: FailureService,
  ) {}

  async dispatchBatch(limit = 10): Promise<DispatchSummary> {
    const claims = await this.outbox.claimAvailable(
      this.owner,
      limit,
      60_000,
      TRANSFER_COMPLETED_TYPE,
    );
    const summary = { claimed: claims.length, published: 0, retried: 0 };
    for (const claim of claims) {
      try {
        if (claim.eventVersion !== 1) {
          throw new PermanentJobError('UNSUPPORTED_EVENT_VERSION');
        }
        let payload;
        try {
          payload = this.outbox.parseTransferCompleted(claim.payload);
        } catch {
          throw new PermanentJobError('INVALID_EVENT_PAYLOAD');
        }
        if (
          payload.eventId !== claim.id ||
          payload.transferId !== claim.aggregateId ||
          claim.eventType !== TRANSFER_COMPLETED_TYPE ||
          claim.aggregateType !== 'transfer'
        ) {
          throw new PermanentJobError('EVENT_MISMATCH');
        }
        let job: Job;
        try {
          job = await this.queue.add(
            TRANSFER_COMPLETED_TYPE,
            { eventId: claim.id },
            { jobId: claim.id },
          );
        } catch {
          throw new Error('REDIS_UNAVAILABLE');
        }
        if (job.id !== claim.id) throw new Error('Queue job ID mismatch');
        const marked = await this.outbox.markPublished(
          claim.id,
          claim.leaseOwner,
          claim.leaseToken,
        );
        if (marked) {
          try {
            await this.failures.resolve(claim.id, 'dispatcher');
          } catch {
            this.logger.warn(
              JSON.stringify({
                eventId: claim.id,
                status: 'failure_resolution_pending',
              }),
            );
          }
          summary.published += 1;
          this.logger.log(
            JSON.stringify({
              eventId: claim.id,
              jobId: job.id,
              status: 'published',
            }),
          );
        }
      } catch (error) {
        const failure = classifyFailure(error);
        if (failure.category === 'permanent') {
          const quarantined = await this.failures.quarantineDispatch(
            claim,
            failure.reason,
          );
          if (quarantined) {
            this.logger.warn(
              JSON.stringify({
                eventId: claim.id,
                status: 'dead_letter',
                reason: failure.reason,
              }),
            );
          }
          continue;
        }
        const retried = await this.outbox.scheduleRetry(
          claim.id,
          claim.leaseOwner,
          claim.leaseToken,
          Math.min(60_000, 1_000 * 2 ** Math.min(claim.attempts, 6)),
          'DELIVERY_FAILED',
        );
        if (retried) {
          summary.retried += 1;
          try {
            await this.failures.record({
              eventId: claim.id,
              jobId: claim.id,
              source: 'dispatcher',
              failure: { category: 'temporary', reason: 'REDIS_UNAVAILABLE' },
              attempts: claim.attempts,
              exhausted: false,
            });
          } catch {
            this.logger.warn(
              JSON.stringify({
                eventId: claim.id,
                status: 'failure_record_pending',
              }),
            );
          }
        }
        this.logger.warn(
          JSON.stringify({ eventId: claim.id, status: 'retry_scheduled' }),
        );
      }
    }
    return summary;
  }

  async runUntilStopped(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.dispatchBatch();
      } catch {
        this.logger.warn('Outbox discovery unavailable; retrying');
      }
      if (!this.stopping) await delay(1_000);
    }
  }

  stop(): void {
    this.stopping = true;
  }
}
