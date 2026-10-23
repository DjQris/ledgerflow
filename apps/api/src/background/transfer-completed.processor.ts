import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';

import { TRANSFER_COMPLETED_TYPE } from '../outbox/outbox-events';
import { NotificationService } from './notification.service';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';
import { classifyFailure, PermanentJobError } from './failure-classification';
import { FailureService, safeJobId } from './failure.service';

@Processor(TRANSFER_EVENTS_QUEUE, {
  concurrency: 5,
  lockDuration: 30_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
})
export class TransferCompletedProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TransferCompletedProcessor.name);
  private reconciliationTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly notifications: NotificationService,
    private readonly failures: FailureService,
    @InjectQueue(TRANSFER_EVENTS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    try {
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
        throw new PermanentJobError('INVALID_JOB');
      }
      const result = await this.notifications.recordTransferCompletion(
        data.eventId,
      );
      await this.failures.resolve(job.id, 'worker');
      this.logger.log(
        JSON.stringify({ eventId: data.eventId, status: result }),
      );
    } catch (error) {
      const failure = classifyFailure(error);
      if (failure.category === 'permanent') {
        throw new UnrecoverableError(failure.reason);
      }
      // Store only a fixed reason code in Redis; the original error may contain sensitive data.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(failure.reason);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<unknown> | undefined, error: Error): Promise<void> {
    if (!job) {
      this.logger.warn('Worker failure without job identity');
      return;
    }
    const failure = classifyFailure(error);
    const attempts = Math.max(1, job.attemptsMade);
    const exhausted =
      failure.category === 'permanent' || attempts >= (job.opts.attempts ?? 1);
    try {
      await this.failures.record({
        eventId: safeJobId(job.id),
        jobId: safeJobId(job.id),
        source: 'worker',
        failure,
        attempts,
        exhausted,
      });
    } catch {
      this.logger.warn(
        JSON.stringify({
          jobId: safeJobId(job.id),
          status: 'failure_record_pending',
        }),
      );
    }
    this.logger.warn(
      JSON.stringify({
        jobId: safeJobId(job.id),
        category: failure.category,
        reason: failure.reason,
        attempts,
        exhausted,
      }),
    );
  }

  @OnWorkerEvent('error')
  onWorkerError(): void {
    this.logger.warn('Worker connection or execution unavailable');
  }

  onModuleInit(): void {
    this.reconciliationTimer = setInterval(() => {
      void this.reconcileFailedJobs();
    }, 15_000);
    this.reconciliationTimer.unref();
    void this.reconcileFailedJobs();
  }

  onModuleDestroy(): void {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
  }

  private async reconcileFailedJobs(): Promise<void> {
    try {
      for (let offset = 0; ; offset += 100) {
        const jobs = await this.queue.getFailed(offset, offset + 99);
        for (const job of jobs) {
          const existing = await this.failures.getByJob(
            'worker',
            safeJobId(job.id),
          );
          if (existing) continue;
          const permanent = job.stacktrace?.some((entry) =>
            entry.includes('UnrecoverableError'),
          );
          const error = permanent
            ? new UnrecoverableError(job.failedReason)
            : new Error(job.failedReason);
          await this.failures.record({
            eventId: safeJobId(job.id),
            jobId: safeJobId(job.id),
            source: 'worker',
            failure: classifyFailure(error),
            attempts: Math.max(1, job.attemptsMade),
            exhausted: true,
          });
        }
        if (jobs.length < 100) break;
      }
    } catch {
      this.logger.warn('Failed-job reconciliation unavailable; will retry');
    }
  }
}
