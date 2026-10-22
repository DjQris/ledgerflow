import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';

import { AuditService } from '../audit/audit.service';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { EnvironmentVariables } from '../config/environment';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
} from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { UsersService } from '../users/users.service';
import { LocalSimulationGuard } from '../common/guards/local-simulation.guard';
import { TransferIdempotencyService } from './transfer-idempotency.service';
import { TransferRejectionAuditInterceptor } from './transfer-rejection-audit.interceptor';
import { TransferResult } from './dto/transfer-result.dto';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

jest.setTimeout(40_000);

const concurrencyRounds = Number(process.env.CONCURRENCY_ROUNDS ?? '1');
if (
  !Number.isInteger(concurrencyRounds) ||
  concurrencyRounds < 1 ||
  concurrencyRounds > 50
) {
  throw new Error('CONCURRENCY_ROUNDS must be an integer between 1 and 50');
}
const rounds = Array.from(
  { length: concurrencyRounds },
  (_, index) => index + 1,
);

const FAILURE_FUNCTION = 'phase1e_raise_transfer_failure';
const FAILURE_TRIGGER = 'phase1e_deliberate_transfer_failure';

describe('Transfer HTTP idempotency PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallets: WalletsService;
  let ledger: LedgerService;
  let config: ConfigService<EnvironmentVariables, true>;
  let simulationEnvironment: 'test' | 'production' = 'test';

  beforeAll(async () => {
    const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error('INTEGRATION_DATABASE_URL is required');
    const name = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (!name.startsWith('ledgerflow_phase1f_integration_')) {
      throw new Error(
        'The HTTP suite requires a dedicated ledgerflow_phase1f_integration_* database',
      );
    }
    config = {
      get: jest.fn((key: keyof EnvironmentVariables) => {
        if (key === 'DATABASE_URL') return databaseUrl;
        if (key === 'NODE_ENV') return simulationEnvironment;
        return undefined;
      }),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    await startApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function startApp(): Promise<void> {
    const module = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [
        { provide: ConfigService, useValue: config },
        PrismaService,
        AuditService,
        TransfersService,
        TransferIdempotencyService,
        TransferRejectionAuditInterceptor,
        LocalSimulationGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        whitelist: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
    await app.init();
    prisma = app.get(PrismaService);
    const audit = app.get(AuditService);
    wallets = new WalletsService(prisma, audit, new UsersService());
    ledger = new LedgerService(prisma, config, audit);
  }

  async function createWallet(label: string) {
    const actor = `test-phase1e-${label}-${randomUUID()}`;
    const wallet = await wallets.create({ ownerReference: actor });
    return { actor, wallet };
  }

  async function fund(walletId: string, amountMinor: bigint): Promise<void> {
    await ledger.postDevelopmentOpeningFunding({
      amountMinor,
      externalReference: `phase1e:${randomUUID()}`,
      walletId,
    });
  }

  function post(actor: string, key: string, body: object) {
    return request(app.getHttpServer() as Server)
      .post('/api/v1/transfers')
      .set('X-Simulated-Actor', actor)
      .set('Idempotency-Key', key)
      .send(body);
  }

  function command(
    sourceWalletId: string,
    destinationWalletId: string,
    amountMinor: string,
  ) {
    return { sourceWalletId, destinationWalletId, amountMinor };
  }

  async function counts() {
    const [transfers, journals, entries, keys] = await Promise.all([
      prisma.transfer.count(),
      prisma.ledgerTransaction.count({
        where: { type: LedgerTransactionType.TRANSFER },
      }),
      prisma.ledgerEntry.count({
        where: { transaction: { type: LedgerTransactionType.TRANSFER } },
      }),
      prisma.idempotencyRecord.count(),
    ]);
    return { transfers, journals, entries, keys };
  }

  it('returns the original result for ten repeats and writes one balanced journal', async () => {
    const source = await createWallet('repeat-source');
    const destination = await createWallet('repeat-dest');
    await fund(source.wallet.id, 2_000_000n);
    const before = await counts();
    const body = command(source.wallet.id, destination.wallet.id, '1000000');
    const key = randomUUID();

    const first = await post(source.actor, key, body).expect(201);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const replay = await post(source.actor, key, body).expect(201);
      expect(replay.body).toEqual(first.body);
    }

    const after = await counts();
    expect(after).toEqual({
      transfers: before.transfers + 1,
      journals: before.journals + 1,
      entries: before.entries + 2,
      keys: before.keys + 1,
    });
    const record = await prisma.idempotencyRecord.findFirstOrThrow({
      include: {
        transfer: {
          include: { ledgerTransaction: { include: { entries: true } } },
        },
      },
      where: { key },
    });
    expect(record.responseBody).toEqual(first.body);
    expect(record.transfer?.id).toBe((first.body as TransferResult).transferId);
    expect(record.transfer?.ledgerTransaction?.status).toBe(
      LedgerTransactionStatus.POSTED,
    );
    expect(
      record.transfer?.ledgerTransaction?.entries.reduce(
        (sum, entry) => sum + entry.amountMinor,
        0n,
      ),
    ).toBe(0n);
  });

  it.each(rounds)(
    'coordinates simultaneous identical requests through the unique database row (round %i)',
    async () => {
      const source = await createWallet('race-source');
      const destination = await createWallet('race-dest');
      await fund(source.wallet.id, 1_000n);
      const before = await counts();
      const body = command(source.wallet.id, destination.wallet.id, '700');
      const key = randomUUID();

      const [first, second] = await Promise.all([
        post(source.actor, key, body),
        post(source.actor, key, body),
      ]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(await counts()).toEqual({
        transfers: before.transfers + 1,
        journals: before.journals + 1,
        entries: before.entries + 2,
        keys: before.keys + 1,
      });
    },
  );

  it('rejects a changed amount on the same actor and key', async () => {
    const source = await createWallet('changed-source');
    const destination = await createWallet('changed-dest');
    await fund(source.wallet.id, 1_000n);
    const key = randomUUID();
    await post(
      source.actor,
      key,
      command(source.wallet.id, destination.wallet.id, '100'),
    ).expect(201);
    const before = await counts();

    const response = await post(
      source.actor,
      key,
      command(source.wallet.id, destination.wallet.id, '101'),
    ).expect(409);
    expect((response.body as { message: string }).message).toContain(
      'different transfer request',
    );
    expect(await counts()).toEqual(before);
  });

  it('allows different simulated actors to use the same key independently', async () => {
    const firstSource = await createWallet('scope-source-a');
    const secondSource = await createWallet('scope-source-b');
    const destination = await createWallet('scope-dest');
    await fund(firstSource.wallet.id, 500n);
    await fund(secondSource.wallet.id, 500n);
    const before = await counts();
    const key = randomUUID();

    const first = await post(
      firstSource.actor,
      key,
      command(firstSource.wallet.id, destination.wallet.id, '100'),
    ).expect(201);
    const second = await post(
      secondSource.actor,
      key,
      command(secondSource.wallet.id, destination.wallet.id, '200'),
    ).expect(201);

    expect((first.body as TransferResult).transferId).not.toBe(
      (second.body as TransferResult).transferId,
    );
    expect(await counts()).toEqual({
      transfers: before.transfers + 2,
      journals: before.journals + 2,
      entries: before.entries + 4,
      keys: before.keys + 2,
    });
  });

  it.each(rounds)(
    'allows at most one of two concurrent debits with different keys (round %i)',
    async () => {
      const source = await createWallet('overspend-source');
      const firstDestination = await createWallet('overspend-first');
      const secondDestination = await createWallet('overspend-second');
      await fund(source.wallet.id, 5_000_000n);
      const before = await counts();

      const responses = await Promise.all([
        post(
          source.actor,
          randomUUID(),
          command(source.wallet.id, firstDestination.wallet.id, '4000000'),
        ),
        post(
          source.actor,
          randomUUID(),
          command(source.wallet.id, secondDestination.wallet.id, '4000000'),
        ),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      const after = await counts();
      expect(after.transfers).toBe(before.transfers + 1);
      expect(after.journals).toBe(before.journals + 1);
      expect(after.entries).toBe(before.entries + 2);
      expect(after.keys).toBe(before.keys + 1);
      const account = await prisma.ledgerAccount.findUniqueOrThrow({
        where: { walletId: source.wallet.id },
      });
      expect(account.cachedBalanceMinor).toBe(1_000_000n);
    },
  );

  it('replays the saved response after an API restart', async () => {
    const source = await createWallet('restart-source');
    const destination = await createWallet('restart-dest');
    await fund(source.wallet.id, 1_000n);
    const body = command(source.wallet.id, destination.wallet.id, '250');
    const key = randomUUID();
    const first = await post(source.actor, key, body).expect(201);
    const before = await counts();

    await app.close();
    await startApp();

    const replay = await post(source.actor, key, body).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await counts()).toEqual(before);
  });

  it('rolls back the key and all financial writes after a late database failure', async () => {
    const source = await createWallet('failure-source');
    const destination = await createWallet('failure-dest');
    await fund(source.wallet.id, 1_000n);
    const body = command(source.wallet.id, destination.wallet.id, '200');
    const key = randomUUID();
    const before = await counts();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${FAILURE_FUNCTION}"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'deliberate Phase 1E failure'; END; $$;
      CREATE TRIGGER "${FAILURE_TRIGGER}" BEFORE UPDATE ON "transfers"
      FOR EACH ROW WHEN (NEW."status" = 'completed')
      EXECUTE FUNCTION "${FAILURE_FUNCTION}"();
    `);
    try {
      await post(source.actor, key, body).expect(500);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "${FAILURE_TRIGGER}" ON "transfers";
        DROP FUNCTION IF EXISTS "${FAILURE_FUNCTION}"();
      `);
    }
    expect(await counts()).toEqual(before);
    await post(source.actor, key, body).expect(201);
  });

  it('requires headers and source ownership, and lists only the actor’s outgoing transfers', async () => {
    const source = await createWallet('actor-source');
    const destination = await createWallet('actor-dest');
    await fund(source.wallet.id, 500n);
    const body = command(source.wallet.id, destination.wallet.id, '100');
    await request(app.getHttpServer() as Server)
      .post('/api/v1/transfers')
      .set('X-Simulated-Actor', source.actor)
      .send(body)
      .expect(400);
    await post(destination.actor, randomUUID(), body).expect(403);
    const created = await post(source.actor, randomUUID(), body).expect(201);

    const sourceList = await request(app.getHttpServer() as Server)
      .get('/api/v1/transfers/')
      .set('X-Simulated-Actor', source.actor)
      .expect(200);
    expect(
      (sourceList.body as Array<{ transferId: string }>).some(
        (item: { transferId: string }) =>
          item.transferId === (created.body as TransferResult).transferId,
      ),
    ).toBe(true);
    const destinationList = await request(app.getHttpServer() as Server)
      .get('/api/v1/transfers/')
      .set('X-Simulated-Actor', destination.actor)
      .expect(200);
    expect(
      (destinationList.body as Array<{ transferId: string }>).some(
        (item: { transferId: string }) =>
          item.transferId === (created.body as TransferResult).transferId,
      ),
    ).toBe(false);
  });

  it('rejects numeric JSON amounts and blocks simulation in production', async () => {
    const source = await createWallet('guard-source');
    const destination = await createWallet('guard-dest');
    await post(source.actor, randomUUID(), {
      amountMinor: 100,
      sourceWalletId: source.wallet.id,
      destinationWalletId: destination.wallet.id,
    }).expect(400);

    simulationEnvironment = 'production';
    try {
      await post(
        source.actor,
        randomUUID(),
        command(source.wallet.id, destination.wallet.id, '100'),
      ).expect(403);
      await request(app.getHttpServer() as Server)
        .get('/api/v1/transfers')
        .set('X-Simulated-Actor', source.actor)
        .expect(403);
    } finally {
      simulationEnvironment = 'test';
    }
  });
});
