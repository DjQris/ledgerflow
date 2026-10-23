import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { OutboxService } from '../outbox/outbox.service';
import { TRANSFER_COMPLETED_TYPE } from '../outbox/outbox-events';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';

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
        const payload = this.outbox.parseTransferCompleted(claim.payload);
        if (
          payload.eventId !== claim.id ||
          payload.transferId !== claim.aggregateId ||
          claim.eventType !== TRANSFER_COMPLETED_TYPE ||
          claim.eventVersion !== 1 ||
          claim.aggregateType !== 'transfer'
        ) {
          throw new Error('Invalid transfer outbox event');
        }
        const job: Job = await this.queue.add(
          TRANSFER_COMPLETED_TYPE,
          { eventId: claim.id },
          { jobId: claim.id },
        );
        if (job.id !== claim.id) throw new Error('Queue job ID mismatch');
        if ((await job.getState()) === 'failed') await job.retry();
        const marked = await this.outbox.markPublished(
          claim.id,
          claim.leaseOwner,
          claim.leaseToken,
        );
        if (marked) {
          summary.published += 1;
          this.logger.log(
            JSON.stringify({
              eventId: claim.id,
              jobId: job.id,
              status: 'published',
            }),
          );
        }
      } catch {
        const retried = await this.outbox.scheduleRetry(
          claim.id,
          claim.leaseOwner,
          claim.leaseToken,
          Math.min(60_000, 1_000 * 2 ** Math.min(claim.attempts, 6)),
          'DELIVERY_FAILED',
        );
        if (retried) summary.retried += 1;
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
