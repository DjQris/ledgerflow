import {
  INestApplication,
  INestApplicationContext,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';

import { AuditService } from '../audit/audit.service';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { configureHttpSecurity } from '../common/http-security';
import { EnvironmentVariables } from '../config/environment';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { DispatcherService } from './dispatcher.service';
import { FailureService } from './failure.service';
import { TRANSFER_EVENTS_QUEUE } from './queue.module';

jest.setTimeout(90_000);

describe('Phase 2G background failure recovery', () => {
  let api: INestApplication;
  let dispatcherApp: INestApplicationContext;
  let workerApp: INestApplicationContext | undefined;
  let workerModuleClass: (typeof import('./worker.module'))['WorkerModule'];
  let prisma: PrismaService;
  let queue: Queue;
  let dispatcher: DispatcherService;
  let failures: FailureService;
  let wallets: WalletsService;
  let ledger: LedgerService;
  let transfers: TransfersService;
  const origin = 'http://localhost:3000';
  const password = 'Correct horse battery staple 2026!';

  beforeAll(async () => {
    const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
    if (
      !databaseUrl ||
      !new URL(databaseUrl).pathname
        .slice(1)
        .startsWith('ledgerflow_phase1f_integration_')
    ) {
      throw new Error('A dedicated integration database is required');
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.NODE_ENV = 'test';
    process.env.AUTH_SIGNING_KEY = randomBytes(48).toString('hex');
    process.env.AUTH_ALLOWED_ORIGIN = origin;
    process.env.AUTH_COOKIE_SECURE = 'false';
    process.env.BACKGROUND_JOB_MAX_ATTEMPTS = '3';
    process.env.BACKGROUND_RETRY_DELAY_MS = '100';

    const [{ AppModule }, { DispatcherModule }, { WorkerModule }] =
      await Promise.all([
        import('../app.module.js'),
        import('./dispatcher.module.js'),
        import('./worker.module.js'),
      ]);
    workerModuleClass = WorkerModule;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    api = module.createNestApplication({ bodyParser: false });
    api.setGlobalPrefix('api/v1');
    configureHttpSecurity(api, {
      CORS_ALLOWED_ORIGINS: [origin],
      NODE_ENV: 'test',
      REQUEST_BODY_LIMIT_BYTES: 16_384,
    });
    api.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        whitelist: true,
      }),
    );
    api.useGlobalFilters(new ApiExceptionFilter(api.get(HttpAdapterHost)));
    await api.init();
    dispatcherApp = await NestFactory.createApplicationContext(
      DispatcherModule,
      { logger: false },
    );
    prisma = dispatcherApp.get(PrismaService);
    queue = dispatcherApp.get<Queue>(getQueueToken(TRANSFER_EVENTS_QUEUE));
    expect(queue.opts.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 100, jitter: 0.5 },
    });
    dispatcher = dispatcherApp.get(DispatcherService);
    failures = dispatcherApp.get(FailureService);
    const config =
      dispatcherApp.get<ConfigService<EnvironmentVariables, true>>(
        ConfigService,
      );
    const audit = new AuditService(prisma);
    wallets = new WalletsService(prisma, audit, new UsersService());
    ledger = new LedgerService(prisma, config, audit);
    transfers = new TransfersService(
      prisma,
      audit,
      dispatcherApp.get(OutboxService),
    );
  });

  afterAll(async () => {
    await workerApp?.close();
    await dispatcherApp?.close();
    await api?.close();
  });

  async function startWorker(): Promise<void> {
    if (!workerApp) {
      workerApp = await NestFactory.createApplicationContext(
        workerModuleClass,
        { logger: false },
      );
    }
  }

  async function stopWorker(): Promise<void> {
    await workerApp?.close();
    workerApp = undefined;
  }

  async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const value = await read();
      if (value !== undefined) return value;
      await delay(100);
    }
    throw new Error('Background result did not arrive');
  }

  async function createTransfer(label: string) {
    const source = await wallets.create({
      ownerReference: `phase2g-${label}-src-${randomUUID()}`,
    });
    const destination = await wallets.create({
      ownerReference: `phase2g-${label}-dst-${randomUUID()}`,
    });
    await ledger.postDevelopmentOpeningFunding({
      amountMinor: 10_000n,
      externalReference: `phase2g:${randomUUID()}`,
      walletId: source.id,
    });
    const transfer = await transfers.execute({
      amountMinor: '1000',
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
    });
    const event = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "outbox_events" WHERE "aggregate_id" = ${transfer.transferId}::uuid
    `;
    const eventId = event[0].id;
    await prisma.$executeRaw`
      UPDATE "outbox_events" SET "created_at" = (
        SELECT COALESCE(MIN("created_at") - INTERVAL '1 second',
          '2020-01-01'::timestamptz)
        FROM "outbox_events" WHERE "id" <> ${eventId}::uuid
      )
      WHERE "id" = ${eventId}::uuid
    `;
    return {
      eventId,
      transferId: transfer.transferId,
      sourceId: source.id,
      destinationId: destination.id,
    };
  }

  async function notificationCount(eventId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS "count" FROM "transaction_notifications"
      WHERE "event_id" = ${eventId}::uuid
    `;
    return Number(rows[0].count);
  }

  async function finances(
    sourceId: string,
    destinationId: string,
    transferId: string,
  ) {
    const balances = await prisma.$queryRaw<
      Array<{ walletId: string; balance: bigint }>
    >`
      SELECT "wallet_id" AS "walletId", "cached_balance_minor" AS "balance"
      FROM "ledger_accounts" WHERE "wallet_id" IN (${sourceId}::uuid, ${destinationId}::uuid)
      ORDER BY "wallet_id"
    `;
    const journals = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS "count" FROM "ledger_transactions"
      WHERE "id" = (SELECT "ledger_transaction_id" FROM "transfers" WHERE "id" = ${transferId}::uuid)
    `;
    return {
      balances: balances.map((row) => [row.walletId, row.balance.toString()]),
      journals: Number(journals[0].count),
    };
  }

  async function account(role: UserRole) {
    const email = `phase2g-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role,
        status: UserStatus.ACTIVE,
      },
    });
    const response = await request(api.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    const headers = response.headers['set-cookie'] as unknown as string[];
    const cookie = headers
      .find((item) => item.startsWith('ledgerflow_access='))
      ?.split(';')[0];
    const csrf = response.headers['x-csrf-token'];
    if (!cookie || !csrf) throw new Error('Test account login failed');
    return { id: user.id, cookie, csrf };
  }

  it('dead-letters an invalid job after one attempt with a sanitized reason', async () => {
    await startWorker();
    const id = randomUUID();
    await queue.add(
      'transfer.completed',
      { eventId: 'invalid-secret-payload' },
      { jobId: id },
    );
    const failure = await waitFor(async () => {
      const row = await failures.getByJob('worker', id);
      return row?.status === 'dead_letter' ? row : undefined;
    });
    expect(failure).toMatchObject({
      eventId: id,
      jobId: id,
      failureCategory: 'permanent',
      failureReason: 'INVALID_JOB',
      attempts: 1,
    });
    expect(JSON.stringify(failure)).not.toContain('invalid-secret-payload');
    expect((await queue.getJob(id))?.attemptsMade).toBe(1);
  });

  it('tracks cumulative attempts across a manual retry cycle', async () => {
    const id = randomUUID();
    const failure = {
      category: 'temporary' as const,
      reason: 'PROCESSING_FAILED',
    };
    for (const attempts of [1, 2, 3]) {
      await failures.record({
        eventId: id,
        jobId: id,
        source: 'worker',
        failure,
        attempts,
        exhausted: attempts === 3,
      });
    }
    expect(await failures.getByJob('worker', id)).toMatchObject({
      attempts: 3,
      status: 'dead_letter',
    });
    await prisma.$executeRaw`
      UPDATE "failed_background_jobs" SET "run_attempts" = 0, "status" = 'retry_pending'
      WHERE "job_id" = ${id} AND "source" = 'worker'
    `;
    await failures.record({
      eventId: id,
      jobId: id,
      source: 'worker',
      failure,
      attempts: 1,
      exhausted: false,
    });
    expect(await failures.getByJob('worker', id)).toMatchObject({
      attempts: 4,
      status: 'retrying',
    });
  });

  it('processes a job left waiting by a stopped worker without repeating finance', async () => {
    await stopWorker();
    const transfer = await createTransfer('preprocess-restart');
    const before = await finances(
      transfer.sourceId,
      transfer.destinationId,
      transfer.transferId,
    );
    expect(await dispatcher.dispatchBatch(1)).toMatchObject({
      claimed: 1,
      published: 1,
    });
    expect(await (await queue.getJob(transfer.eventId))?.getState()).toBe(
      'waiting',
    );
    await startWorker();
    await waitFor(async () =>
      (await notificationCount(transfer.eventId)) === 1 ? true : undefined,
    );
    expect(
      await finances(
        transfer.sourceId,
        transfer.destinationId,
        transfer.transferId,
      ),
    ).toEqual(before);
  });

  it('deduplicates a post-commit, pre-acknowledgement worker failure', async () => {
    await startWorker();
    const transfer = await createTransfer('postcommit-restart');
    const before = await finances(
      transfer.sourceId,
      transfer.destinationId,
      transfer.transferId,
    );
    const workerFailures = workerApp!.get(FailureService);
    const original = workerFailures.resolve.bind(workerFailures);
    let failOnce = true;
    workerFailures.resolve = async (jobId, source) => {
      if (jobId === transfer.eventId && failOnce) {
        failOnce = false;
        throw new Error('Simulated crash after database commit');
      }
      return original(jobId, source);
    };
    try {
      await dispatcher.dispatchBatch(1);
      await waitFor(async () => {
        const job = await queue.getJob(transfer.eventId);
        return job && (await job.getState()) === 'completed' ? true : undefined;
      });
    } finally {
      workerFailures.resolve = original;
    }
    expect(failOnce).toBe(false);
    expect((await queue.getJob(transfer.eventId))?.attemptsMade).toBe(2);
    expect(await notificationCount(transfer.eventId)).toBe(1);
    expect(
      await finances(
        transfer.sourceId,
        transfer.destinationId,
        transfer.transferId,
      ),
    ).toEqual(before);
  });

  it('exhausts temporary database failures, then restricts and audits manual recovery', async () => {
    await startWorker();
    const transfer = await createTransfer('db-exhaustion');
    const before = await finances(
      transfer.sourceId,
      transfer.destinationId,
      transfer.transferId,
    );
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "phase2g_reject_notification"()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Transient test failure' USING ERRCODE = '53300'; END; $$;
      CREATE TRIGGER "phase2g_reject_notification_insert"
      BEFORE INSERT ON "transaction_notifications"
      FOR EACH ROW EXECUTE FUNCTION "phase2g_reject_notification"();
    `);
    try {
      await dispatcher.dispatchBatch(1);
      await waitFor(async () => {
        const job = await queue.getJob(transfer.eventId);
        return job && (await job.getState()) === 'failed' ? true : undefined;
      });
      const failure = await waitFor(async () => {
        const row = await failures.getByJob('worker', transfer.eventId);
        return row?.status === 'dead_letter' ? row : undefined;
      });
      expect(failure).toMatchObject({
        attempts: 3,
        failureCategory: 'temporary',
        status: 'dead_letter',
      });
      expect(await notificationCount(transfer.eventId)).toBe(0);

      const server = api.getHttpServer() as Server;
      await request(server).get('/api/v1/ops/jobs/failed').expect(401);
      const customer = await account(UserRole.CUSTOMER);
      await request(server)
        .get('/api/v1/ops/jobs/failed')
        .set('Cookie', customer.cookie)
        .expect(403);
      await request(server)
        .post(`/api/v1/ops/jobs/${failure.id}/retry`)
        .set('Cookie', customer.cookie)
        .set('X-CSRF-Token', customer.csrf)
        .expect(403);
      const operations = await account(UserRole.OPERATIONS);
      const listed = await request(server)
        .get('/api/v1/ops/jobs/failed')
        .set('Cookie', operations.cookie)
        .expect(200);
      expect(
        (listed.body as Array<{ id: string }>).some(
          (row) => row.id === failure.id,
        ),
      ).toBe(true);
      await request(server)
        .get(`/api/v1/ops/jobs/${failure.id}`)
        .set('Cookie', operations.cookie)
        .expect(200);
      const outbox = await request(server)
        .get('/api/v1/ops/outbox')
        .set('Cookie', operations.cookie)
        .expect(200);
      expect(JSON.stringify(outbox.body)).not.toContain('payload');
      await request(server)
        .post(`/api/v1/ops/jobs/${failure.id}/retry`)
        .set('Cookie', operations.cookie)
        .expect(403);

      await prisma.$executeRawUnsafe(`
        DROP TRIGGER "phase2g_reject_notification_insert" ON "transaction_notifications";
        DROP FUNCTION "phase2g_reject_notification"();
      `);
      await stopWorker();
      const attempts = await Promise.all(
        [0, 1].map(() =>
          request(server)
            .post(`/api/v1/ops/jobs/${failure.id}/retry`)
            .set('Cookie', operations.cookie)
            .set('X-CSRF-Token', operations.csrf),
        ),
      );
      expect(attempts.map((result) => result.status).sort()).toEqual([
        201, 409,
      ]);
      const recovered = attempts.find((result) => result.status === 201)!;
      expect(recovered.body).toMatchObject({
        status: 'queued',
        jobId: transfer.eventId,
      });
      await startWorker();
      await waitFor(async () =>
        (await notificationCount(transfer.eventId)) === 1 ? true : undefined,
      );
      expect(
        await finances(
          transfer.sourceId,
          transfer.destinationId,
          transfer.transferId,
        ),
      ).toEqual(before);
      const recorded = await failures.getById(failure.id);
      expect(recorded?.retryActorId).toBe(operations.id);
      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: {
          action: 'background_retry_requested',
          actorId: operations.id,
          entityId: failure.id,
        },
      });
      expect(audit.outcome).toBe('SUCCEEDED');
      const second = await request(server)
        .post(`/api/v1/ops/jobs/${failure.id}/retry`)
        .set('Cookie', operations.cookie)
        .set('X-CSRF-Token', operations.csrf)
        .expect(201);
      expect(second.body).toMatchObject({ status: 'already_processed' });
      return;
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "phase2g_reject_notification_insert" ON "transaction_notifications";
        DROP FUNCTION IF EXISTS "phase2g_reject_notification"();
      `);
    }
  });

  it('quarantines an unsupported outbox event instead of retrying forever', async () => {
    const transfer = await createTransfer('unsupported-version');
    const before = await finances(
      transfer.sourceId,
      transfer.destinationId,
      transfer.transferId,
    );
    await prisma.$executeRaw`
      UPDATE "outbox_events" SET "event_version" = 99 WHERE "id" = ${transfer.eventId}::uuid
    `;
    expect(await dispatcher.dispatchBatch(1)).toMatchObject({
      claimed: 1,
      published: 0,
    });
    const failure = await failures.getByJob('dispatcher', transfer.eventId);
    expect(failure).toMatchObject({
      failureCategory: 'permanent',
      failureReason: 'UNSUPPORTED_EVENT_VERSION',
      status: 'dead_letter',
    });
    const rows = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status" FROM "outbox_events" WHERE "id" = ${transfer.eventId}::uuid
    `;
    expect(rows[0].status).toBe('dead_letter');
    const operations = await account(UserRole.OPERATIONS);
    await request(api.getHttpServer() as Server)
      .post(`/api/v1/ops/jobs/${failure!.id}/retry`)
      .set('Cookie', operations.cookie)
      .set('X-CSRF-Token', operations.csrf)
      .expect(409);
    await prisma.$executeRaw`
      UPDATE "outbox_events" SET "event_version" = 1 WHERE "id" = ${transfer.eventId}::uuid
    `;
    const retry = await request(api.getHttpServer() as Server)
      .post(`/api/v1/ops/jobs/${failure!.id}/retry`)
      .set('Cookie', operations.cookie)
      .set('X-CSRF-Token', operations.csrf)
      .expect(201);
    expect(retry.body).toMatchObject({ status: 'queued_for_dispatch' });
    expect(await dispatcher.dispatchBatch(1)).toMatchObject({
      claimed: 1,
      published: 1,
    });
    await waitFor(async () =>
      (await notificationCount(transfer.eventId)) === 1 ? true : undefined,
    );
    expect(
      await finances(
        transfer.sourceId,
        transfer.destinationId,
        transfer.transferId,
      ),
    ).toEqual(before);
  });
});
