import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';

import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import {
  AuditOutcome,
  LedgerTransactionStatus,
  LedgerTransactionType,
} from '../generated/prisma/enums';
import { LedgerIntegrityService } from '../integrity/ledger-integrity.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransferResult } from '../transfers/dto/transfer-result.dto';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';

jest.setTimeout(40_000);

describe('Phase 1 audit and ledger integrity PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let integrity: LedgerIntegrityService;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error('INTEGRATION_DATABASE_URL is required');
    const name = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (!name.startsWith('ledgerflow_phase1f_integration_')) {
      throw new Error(
        'Phase 1 tests require a ledgerflow_phase1f_integration_* database',
      );
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = 'test';

    const { AppModule } = await import('../app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
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
    ledger = app.get(LedgerService);
    integrity = app.get(LedgerIntegrityService);
  });

  afterAll(async () => {
    await app?.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  async function createWallet(
    label: string,
  ): Promise<{ actor: string; id: string }> {
    const actor = `test-phase1f-${label}-${randomUUID()}`;
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/wallets')
      .send({ ownerReference: actor })
      .expect(201);
    const body = response.body as { id: string; balanceMinor: string };
    expect(body.balanceMinor).toBe('0');
    return { actor, id: body.id };
  }

  async function fund(walletId: string, amountMinor: bigint): Promise<string> {
    const result = await ledger.postDevelopmentOpeningFunding({
      amountMinor,
      externalReference: `phase1f:${randomUUID()}`,
      walletId,
    });
    return result.journalId;
  }

  function post(
    actor: string,
    key: string,
    sourceId: string,
    destinationId: string,
    amountMinor: string,
  ) {
    return request(app.getHttpServer() as Server)
      .post('/api/v1/transfers')
      .set('X-Simulated-Actor', actor)
      .set('Idempotency-Key', key)
      .send({
        sourceWalletId: sourceId,
        destinationWalletId: destinationId,
        amountMinor,
      });
  }

  it('covers wallet, funding, transfer, idempotency, audit API, and clean integrity', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/health')
      .expect(200);
    const source = await createWallet('complete-source');
    const destination = await createWallet('complete-dest');
    const fundingJournalId = await fund(source.id, 1_000n);
    const key = randomUUID();

    const first = await post(
      source.actor,
      key,
      source.id,
      destination.id,
      '250',
    ).expect(201);
    const replay = await post(
      source.actor,
      key,
      source.id,
      destination.id,
      '250',
    ).expect(201);
    expect(replay.body).toEqual(first.body);
    const transfer = first.body as TransferResult;

    const sourceWallet = await request(app.getHttpServer() as Server)
      .get(`/api/v1/wallets/${source.id}`)
      .expect(200);
    expect((sourceWallet.body as { balanceMinor: string }).balanceMinor).toBe(
      '750',
    );
    const walletList = await request(app.getHttpServer() as Server)
      .get('/api/v1/wallets')
      .expect(200);
    expect(
      (walletList.body as Array<{ id: string }>).some(
        (item) => item.id === source.id,
      ),
    ).toBe(true);
    const history = await request(app.getHttpServer() as Server)
      .get(`/api/v1/wallets/${source.id}/transactions`)
      .expect(200);
    expect(
      (history.body as { pagination: { total: number } }).pagination.total,
    ).toBe(2);
    const transferList = await request(app.getHttpServer() as Server)
      .get('/api/v1/transfers')
      .set('X-Simulated-Actor', source.actor)
      .expect(200);
    expect(
      (transferList.body as Array<{ transferId: string }>).some(
        (item) => item.transferId === transfer.transferId,
      ),
    ).toBe(true);

    const events = await request(app.getHttpServer() as Server)
      .get('/api/v1/audit-events?limit=100')
      .expect(200);
    const relevant = (events.body as AuditEventResponseDto[]).filter((event) =>
      [source.id, destination.id, transfer.transferId].includes(event.entityId),
    );
    expect(relevant.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'wallet_created',
        'development_opening_funding_posted',
        'transfer_completed',
      ]),
    );
    expect(
      relevant.every((event) => event.outcome === AuditOutcome.SUCCEEDED),
    ).toBe(true);
    expect(
      relevant.filter((event) => event.action === 'transfer_completed'),
    ).toHaveLength(1);

    const journals = await prisma.ledgerTransaction.findMany({
      include: { entries: true },
      where: { id: { in: [fundingJournalId, transfer.journalId] } },
    });
    expect(journals).toHaveLength(2);
    expect(
      journals.every(
        (journal) =>
          journal.status === LedgerTransactionStatus.POSTED &&
          journal.entries.reduce(
            (sum, entry) => sum + entry.amountMinor,
            0n,
          ) === 0n,
      ),
    ).toBe(true);

    const report = await integrity.verify();
    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('records rejected transfers and idempotency conflicts without financial writes', async () => {
    const source = await createWallet('rejected-source');
    const destination = await createWallet('rejected-dest');
    await fund(source.id, 500n);
    const transferCountBefore = await prisma.transfer.count();
    const keyCountBefore = await prisma.idempotencyRecord.count();

    await post(
      source.actor,
      randomUUID(),
      source.id,
      destination.id,
      '600',
    ).expect(409);
    await post(
      source.actor,
      randomUUID(),
      source.id,
      destination.id,
      '0',
    ).expect(400);
    expect(await prisma.transfer.count()).toBe(transferCountBefore);
    expect(await prisma.idempotencyRecord.count()).toBe(keyCountBefore);

    const key = randomUUID();
    await post(source.actor, key, source.id, destination.id, '100').expect(201);
    const countAfterSuccess = await prisma.transfer.count();
    await post(source.actor, key, source.id, destination.id, '101').expect(409);
    expect(await prisma.transfer.count()).toBe(countAfterSuccess);

    const events = await prisma.auditEvent.findMany({
      where: { entityId: source.id },
    });
    expect(
      events.some(
        (event) =>
          event.action === 'transfer_rejected' &&
          event.outcome === AuditOutcome.REJECTED,
      ),
    ).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.action === 'transfer_rejected' &&
          event.outcome === AuditOutcome.REJECTED,
      ),
    ).toHaveLength(2);
    expect(
      events.some(
        (event) =>
          event.action === 'idempotency_conflict' &&
          event.outcome === AuditOutcome.REJECTED,
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain(key);
    const account = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { walletId: source.id },
    });
    expect(account.cachedBalanceMinor).toBe(400n);
  });

  it('rolls back financial writes when the success audit insert fails late', async () => {
    const source = await createWallet('audit-failure-source');
    const destination = await createWallet('audit-failure-dest');
    await fund(source.id, 500n);
    const beforeTransfers = await prisma.transfer.count();
    const beforeKeys = await prisma.idempotencyRecord.count();
    const key = randomUUID();

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "phase1f_fail_success_audit"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'deliberate audit insertion failure'; END; $$;
      CREATE TRIGGER "phase1f_fail_success_audit_trigger" BEFORE INSERT ON "audit_events"
      FOR EACH ROW WHEN (NEW."action" = 'transfer_completed')
      EXECUTE FUNCTION "phase1f_fail_success_audit"();
    `);
    try {
      await post(source.actor, key, source.id, destination.id, '100').expect(
        500,
      );
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "phase1f_fail_success_audit_trigger" ON "audit_events";
        DROP FUNCTION IF EXISTS "phase1f_fail_success_audit"();
      `);
    }

    expect(await prisma.transfer.count()).toBe(beforeTransfers);
    expect(await prisma.idempotencyRecord.count()).toBe(beforeKeys);
    const sourceAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { walletId: source.id },
    });
    expect(sourceAccount.cachedBalanceMinor).toBe(500n);
    await post(source.actor, key, source.id, destination.id, '100').expect(201);
  });

  it('rejects audit updates, deletes, and truncation at the database boundary', async () => {
    const wallet = await createWallet('immutable');
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: wallet.id },
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: event.id },
        data: { action: 'tampered' },
      }),
    ).rejects.toThrow('Audit events are immutable');
    await expect(
      prisma.auditEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow('Audit events are immutable');
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_events"'),
    ).rejects.toThrow('Audit events are immutable');
  });

  it('detects and then clears a wallet balance projection discrepancy', async () => {
    const wallet = await createWallet('projection');
    await fund(wallet.id, 100n);
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "ledger_accounts" DISABLE TRIGGER "ledger_accounts_balance_projection_guard"',
    );
    try {
      await prisma.ledgerAccount.update({
        where: { walletId: wallet.id },
        data: { cachedBalanceMinor: { increment: 1n } },
      });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "ledger_accounts" ENABLE TRIGGER "ledger_accounts_balance_projection_guard"',
      );
    }
    try {
      const report = await integrity.verify();
      expect(report.ok).toBe(false);
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'WALLET_BALANCE_MISMATCH',
            resourceId: wallet.id,
          }),
        ]),
      );
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "ledger_accounts" DISABLE TRIGGER "ledger_accounts_balance_projection_guard"',
      );
      try {
        await prisma.ledgerAccount.update({
          where: { walletId: wallet.id },
          data: { cachedBalanceMinor: 100n },
        });
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ledger_accounts" ENABLE TRIGGER "ledger_accounts_balance_projection_guard"',
        );
      }
    }
    expect((await integrity.verify()).ok).toBe(true);
  });

  it('detects a deliberately unbalanced posted journal in the isolated database', async () => {
    const account = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { code: 'SYSTEM_FUNDING_CLEARING_NGN' },
    });
    const journal = await prisma.ledgerTransaction.create({
      data: {
        currency: 'NGN',
        type: LedgerTransactionType.ADJUSTMENT,
        externalReference: `phase1f-corrupt:${randomUUID()}`,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        accountId: account.id,
        amountMinor: 1n,
        transactionId: journal.id,
      },
    });

    await prisma.$executeRawUnsafe(
      'ALTER TABLE "ledger_transactions" DISABLE TRIGGER "ledger_transactions_integrity_trigger"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "ledger_transactions" DISABLE TRIGGER "ledger_transactions_balance_cache_trigger"',
    );
    try {
      await prisma.ledgerTransaction.update({
        where: { id: journal.id },
        data: {
          postedAt: new Date(),
          status: LedgerTransactionStatus.POSTED,
        },
      });
      const report = await integrity.verify();
      expect(report.ok).toBe(false);
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNBALANCED_JOURNAL',
            resourceId: journal.id,
          }),
        ]),
      );
      await prisma.ledgerTransaction.update({
        where: { id: journal.id },
        data: {
          postedAt: null,
          status: LedgerTransactionStatus.PENDING,
        },
      });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "ledger_transactions" ENABLE TRIGGER "ledger_transactions_balance_cache_trigger"',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "ledger_transactions" ENABLE TRIGGER "ledger_transactions_integrity_trigger"',
      );
    }
    await prisma.ledgerEntry.deleteMany({
      where: { transactionId: journal.id },
    });
    await prisma.ledgerTransaction.delete({ where: { id: journal.id } });
    expect((await integrity.verify()).ok).toBe(true);
  });
});
