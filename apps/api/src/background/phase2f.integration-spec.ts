import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { AuditService } from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import { requirePhase4IntegrationEnvironment } from '../database/integration-safety';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { redisConnection } from './background-environment';
import { DispatcherService } from './dispatcher.service';
import { FailureService } from './failure.service';
import { NotificationService } from './notification.service';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';

jest.setTimeout(60_000);

describe('Phase 2F BullMQ delivery', () => {
  let dispatcherApp: INestApplicationContext;
  let workerApp: INestApplicationContext;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let dispatcher: DispatcherService;
  let queue: Queue;
  let transfers: TransfersService;
  let wallets: WalletsService;
  let ledger: LedgerService;
  let workerModuleClass: (typeof import('./worker.module'))['WorkerModule'];

  beforeAll(async () => {
    const { databaseUrl, redisUrl } = requirePhase4IntegrationEnvironment({
      redis: true,
    });
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;

    const [{ WorkerModule }, { DispatcherModule }] = await Promise.all([
      import('./worker.module.js'),
      import('./dispatcher.module.js'),
    ]);
    workerModuleClass = WorkerModule;

    workerApp = await NestFactory.createApplicationContext(workerModuleClass);
    dispatcherApp =
      await NestFactory.createApplicationContext(DispatcherModule);
    prisma = dispatcherApp.get(PrismaService);
    outbox = dispatcherApp.get(OutboxService);
    dispatcher = dispatcherApp.get(DispatcherService);
    queue = dispatcherApp.get<Queue>(getQueueToken(TRANSFER_EVENTS_QUEUE));
    expect(queue.opts.defaultJobOptions).toMatchObject({
      attempts: 5,
      removeOnComplete: false,
      removeOnFail: false,
    });
    const config =
      dispatcherApp.get<ConfigService<EnvironmentVariables, true>>(
        ConfigService,
      );
    const audit = new AuditService(prisma);
    wallets = new WalletsService(prisma, audit, new UsersService());
    ledger = new LedgerService(prisma, config, audit);
    transfers = new TransfersService(prisma, audit, outbox);
  });

  afterAll(async () => {
    await dispatcherApp?.close();
    await workerApp?.close();
  });

  async function createTransfer(label: string): Promise<{
    eventId: string;
    recipientUserId: string;
    transferId: string;
  }> {
    const source = await wallets.create({
      ownerReference: `test-phase2f-${label}-src-${randomUUID()}`,
    });
    const destination = await wallets.create({
      ownerReference: `test-phase2f-${label}-dst-${randomUUID()}`,
    });
    await ledger.postDevelopmentOpeningFunding({
      amountMinor: 10_000n,
      externalReference: `phase2f:${randomUUID()}`,
      walletId: source.id,
    });
    const transfer = await transfers.execute({
      amountMinor: '1000',
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
    });
    const events = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "outbox_events" WHERE "aggregate_id" = ${transfer.transferId}::uuid
        AND "event_type" = 'transfer.completed'
    `;
    expect(events).toHaveLength(1);
    const eventId = events[0].id;
    // Keep this event first even after repeated runs leave older pending test rows.
    await prisma.$executeRaw`
      UPDATE "outbox_events" SET "created_at" = (
        SELECT COALESCE(MIN("created_at") - INTERVAL '1 second',
          '2020-01-01'::timestamptz)
        FROM "outbox_events" WHERE "id" <> ${eventId}::uuid
      )
      WHERE "id" = ${eventId}::uuid
    `;
    const walletRows = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT "user_id" AS "userId" FROM "wallets" WHERE "id" = ${source.id}::uuid
    `;
    return {
      eventId,
      recipientUserId: walletRows[0].userId,
      transferId: transfer.transferId,
    };
  }

  async function waitForNotification(eventId: string): Promise<{
    eventId: string;
    recipientUserId: string;
    transferId: string;
    status: string;
  }> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.$queryRaw<
        Array<{
          eventId: string;
          recipientUserId: string;
          transferId: string;
          status: string;
        }>
      >`
        SELECT "event_id" AS "eventId", "recipient_user_id" AS "recipientUserId",
          "transfer_id" AS "transferId", "status"::text AS "status"
        FROM "transaction_notifications" WHERE "event_id" = ${eventId}::uuid
      `;
      if (rows[0]) return rows[0];
      await delay(100);
    }
    throw new Error('Notification was not recorded in time');
  }

  async function notificationCount(eventId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM "transaction_notifications"
      WHERE "event_id" = ${eventId}::uuid
    `;
    return Number(rows[0].count);
  }

  async function waitForJobCompletion(eventId: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const job = await queue.getJob(eventId);
      if (job && (await job.getState()) === 'completed') return;
      await delay(100);
    }
    throw new Error('BullMQ job did not complete in time');
  }

  it('delivers a committed transfer and records exactly one notification across worker restart', async () => {
    const event = await createTransfer('delivery');
    expect(await notificationCount(event.eventId)).toBe(0);
    expect(await dispatcher.dispatchBatch(1)).toMatchObject({
      claimed: 1,
      published: 1,
    });
    const job = await queue.getJob(event.eventId);
    expect(job?.id).toBe(event.eventId);
    expect(job?.data).toEqual({ eventId: event.eventId });
    if (!job) throw new Error('BullMQ job was not created');
    expect(await waitForNotification(event.eventId)).toEqual({
      eventId: event.eventId,
      recipientUserId: event.recipientUserId,
      transferId: event.transferId,
      status: 'recorded',
    });
    const processed = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "processed_events" WHERE "id" = ${event.eventId}::uuid
    `;
    expect(processed).toHaveLength(1);

    await waitForJobCompletion(event.eventId);

    await workerApp.close();
    await job.remove();
    workerApp = await NestFactory.createApplicationContext(workerModuleClass, {
      logger: false,
    });
    await queue.add(
      'transfer.completed',
      { eventId: event.eventId },
      { jobId: event.eventId },
    );
    await waitForJobCompletion(event.eventId);
    const notificationService = workerApp.get(NotificationService);
    expect(
      await notificationService.recordTransferCompletion(event.eventId),
    ).toBe('duplicate');
    expect(await notificationCount(event.eventId)).toBe(1);
  });

  it('fences competing dispatchers and retains a single stable job ID', async () => {
    const event = await createTransfer('competing');
    const other = new DispatcherService(
      outbox,
      queue,
      dispatcherApp.get(FailureService),
    );
    await Promise.all([dispatcher.dispatchBatch(1), other.dispatchBatch(1)]);
    const job = await queue.getJob(event.eventId);
    expect(job?.id).toBe(event.eventId);
    await waitForNotification(event.eventId);
    expect(await notificationCount(event.eventId)).toBe(1);
    const rows = await prisma.$queryRaw<
      Array<{ status: string; attempts: number }>
    >`
      SELECT "status"::text AS "status", "attempts" FROM "outbox_events"
      WHERE "id" = ${event.eventId}::uuid
    `;
    expect(rows[0]).toMatchObject({ status: 'published', attempts: 1 });
  });

  it('commits finances while Redis is unavailable and delivers after recovery', async () => {
    const unavailable = new Queue(TRANSFER_EVENTS_QUEUE, {
      connection: redisConnection('redis://127.0.0.1:6399', 'dispatcher'),
    });
    unavailable.on('error', () => undefined);
    const event = await createTransfer('redis-outage');
    try {
      const isolated = new DispatcherService(
        outbox,
        unavailable,
        dispatcherApp.get(FailureService),
      );
      expect(await isolated.dispatchBatch(1)).toMatchObject({
        claimed: 1,
        retried: 1,
      });
    } finally {
      await unavailable.close();
    }
    expect(await notificationCount(event.eventId)).toBe(0);
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: event.transferId },
    });
    expect(transfer.status).toBe('COMPLETED');
    await delay(2_500);
    expect(await dispatcher.dispatchBatch(1)).toMatchObject({
      claimed: 1,
      published: 1,
    });
    await waitForNotification(event.eventId);
    expect(await notificationCount(event.eventId)).toBe(1);
  });

  it('rolls back its processed marker if notification insertion fails', async () => {
    const event = await createTransfer('notification-rollback');
    const notifications = workerApp.get(NotificationService);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "phase2f_reject_notification"()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Deliberate Phase 2F notification failure'; END; $$;
      CREATE TRIGGER "phase2f_reject_notification_insert"
      BEFORE INSERT ON "transaction_notifications"
      FOR EACH ROW EXECUTE FUNCTION "phase2f_reject_notification"();
    `);
    try {
      await expect(
        notifications.recordTransferCompletion(event.eventId),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "phase2f_reject_notification_insert"
          ON "transaction_notifications";
        DROP FUNCTION IF EXISTS "phase2f_reject_notification"();
      `);
    }
    const processed = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "processed_events" WHERE "id" = ${event.eventId}::uuid
    `;
    expect(processed).toHaveLength(0);
    expect(await notificationCount(event.eventId)).toBe(0);
    expect(await notifications.recordTransferCompletion(event.eventId)).toBe(
      'recorded',
    );
    expect(await notificationCount(event.eventId)).toBe(1);
  });
});
