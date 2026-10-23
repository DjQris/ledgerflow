import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { TRANSFER_COMPLETED_TYPE } from '../outbox/outbox-events';
import { NotificationService } from './notification.service';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';

@Processor(TRANSFER_EVENTS_QUEUE, { concurrency: 5 })
export class TransferCompletedProcessor extends WorkerHost {
  private readonly logger = new Logger(TransferCompletedProcessor.name);

  constructor(private readonly notifications: NotificationService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const data = job.data;
    if (
      job.name !== TRANSFER_COMPLETED_TYPE ||
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data) ||
      !('eventId' in data) ||
      typeof data.eventId !== 'string' ||
      data.eventId !== job.id
    ) {
      throw new Error('Invalid transfer event job');
    }
    try {
      const result = await this.notifications.recordTransferCompletion(
        data.eventId,
      );
      this.logger.log(
        JSON.stringify({ eventId: data.eventId, status: result }),
      );
    } catch {
      throw new Error('Transfer event processing failed');
    }
  }
}
