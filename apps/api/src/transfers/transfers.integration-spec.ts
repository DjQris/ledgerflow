import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
  TransferStatus,
} from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../outbox/outbox.service';
import { parseTransferCompletedPayload } from '../outbox/outbox-events';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { UsersService } from '../users/users.service';
import {
  InsufficientFundsError,
  TransferPersistenceError,
  WalletNotFoundError,
} from './errors/transfer.errors';
import { TransfersService } from './transfers.service';

jest.setTimeout(30_000);

const FAILURE_TRIGGER = 'phase1d_deliberate_transfer_failure';
const FAILURE_FUNCTION = 'phase1d_raise_transfer_failure';
const OUTBOX_FAILURE_TRIGGER = 'phase2e_deliberate_outbox_failure';
const OUTBOX_FAILURE_FUNCTION = 'phase2e_raise_outbox_failure';

describe('TransfersService PostgreSQL integration', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let transfers: TransfersService;
  let wallets: WalletsService;

  beforeAll(async () => {
    const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('INTEGRATION_DATABASE_URL is required');
    }

    const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (!databaseName.startsWith('ledgerflow_phase1f_integration_')) {
      throw new Error(
        'Integration tests require a dedicated ledgerflow_phase1f_integration_* database',
      );
    }

    const config = {
      get: jest.fn((key: keyof EnvironmentVariables) => {
        if (key === 'DATABASE_URL') return databaseUrl;
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    prisma = new PrismaService(config);
    await prisma.onModuleInit();
    const audit = new AuditService(prisma);
    wallets = new WalletsService(prisma, audit, new UsersService());
    ledger = new LedgerService(prisma, config, audit);
    transfers = new TransfersService(prisma, audit, new OutboxService(prisma));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('commits one balanced transfer and updates both balances exactly once', async () => {
    const source = await createWallet('success-source');
    const destination = await createWallet('success-destination');
    await fundWallet(source.id, '1000000', 'success');

    const result = await transfers.execute({
      amountMinor: '300000',
      destinationWalletId: destination.id,
      sourceWalletId: source.id,
    });

    expect(result).toMatchObject({
      amountMinor: '300000',
      destinationBalanceMinor: '300000',
      sourceBalanceMinor: '700000',
      status: TransferStatus.COMPLETED,
    });

    const transfer = await prisma.transfer.findUniqueOrThrow({
      include: { ledgerTransaction: { include: { entries: true } } },
      where: { id: result.transferId },
    });
    const entries = transfer.ledgerTransaction?.entries ?? [];

    expect(transfer.status).toBe(TransferStatus.COMPLETED);
    expect(transfer.ledgerTransaction?.status).toBe(
      LedgerTransactionStatus.POSTED,
    );
    expect(entries).toHaveLength(2);
    expect(
      entries.reduce((total, entry) => total + entry.amountMinor, 0n),
    ).toBe(0n);
    expect(entries.map((entry) => entry.amountMinor).sort()).toEqual([
      -300_000n,
      300_000n,
    ]);

    const events = await prisma.$queryRaw<
      Array<{ id: string; payload: unknown }>
    >`
      SELECT "id", "payload" FROM "outbox_events"
      WHERE "event_type" = 'transfer.completed'
        AND "aggregate_id" = ${result.transferId}::uuid
    `;
    expect(events).toHaveLength(1);
    expect(parseTransferCompletedPayload(events[0]?.payload)).toEqual({
      eventType: 'transfer.completed',
      eventVersion: 1,
      eventId: events[0]?.id,
      transferId: result.transferId,
      occurredAt: result.completedAt,
    });

    await expectBalances(source.id, 700_000n, destination.id, 300_000n);
  });

  it('rejects insufficient funds without creating financial writes', async () => {
    const source = await createWallet('insufficient-source');
    const destination = await createWallet('insufficient-destination');
    await fundWallet(source.id, '100', 'insufficient');
    const before = await financialCounts();

    await expect(
      transfers.execute({
        amountMinor: '101',
        destinationWalletId: destination.id,
        sourceWalletId: source.id,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(await financialCounts()).toEqual(before);
    await expectBalances(source.id, 100n, destination.id, 0n);
  });

  it('serializes concurrent debits so the sender cannot overspend', async () => {
    const source = await createWallet('concurrent-source');
    const firstDestination = await createWallet('concurrent-destination-a');
    const secondDestination = await createWallet('concurrent-destination-b');
    await fundWallet(source.id, '1000', 'concurrent');
    const before = await financialCounts();

    const outcomes = await Promise.all([
      transfers
        .execute({
          amountMinor: '700',
          destinationWalletId: firstDestination.id,
          sourceWalletId: source.id,
        })
        .then((result) => ({ result, succeeded: true as const }))
        .catch((error: unknown) => ({ error, succeeded: false as const })),
      transfers
        .execute({
          amountMinor: '700',
          destinationWalletId: secondDestination.id,
          sourceWalletId: source.id,
        })
        .then((result) => ({ result, succeeded: true as const }))
        .catch((error: unknown) => ({ error, succeeded: false as const })),
    ]);
    const successes = outcomes.filter((outcome) => outcome.succeeded);
    const failures = outcomes.filter((outcome) => !outcome.succeeded);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    expect(
      failure && !failure.succeeded ? failure.error : undefined,
    ).toBeInstanceOf(InsufficientFundsError);

    const after = await financialCounts();
    expect(after).toEqual({
      entriesCount: before.entriesCount + 2,
      journalsCount: before.journalsCount + 1,
      outboxCount: before.outboxCount + 1,
      transfersCount: before.transfersCount + 1,
    });

    const accounts = await prisma.ledgerAccount.findMany({
      select: { cachedBalanceMinor: true, walletId: true },
      where: {
        walletId: {
          in: [source.id, firstDestination.id, secondDestination.id],
        },
      },
    });
    const balances = new Map(
      accounts.map((account) => [account.walletId, account.cachedBalanceMinor]),
    );

    expect(balances.get(source.id)).toBe(300n);
    expect(
      (balances.get(firstDestination.id) ?? 0n) +
        (balances.get(secondDestination.id) ?? 0n),
    ).toBe(700n);
  });

  it('rolls back all writes when completion fails after journal posting', async () => {
    const source = await createWallet('rollback-source');
    const destination = await createWallet('rollback-destination');
    await fundWallet(source.id, '1000', 'rollback');
    const before = await financialCounts();

    await installFailureTrigger();
    try {
      await expect(
        transfers.execute({
          amountMinor: '250',
          destinationWalletId: destination.id,
          sourceWalletId: source.id,
        }),
      ).rejects.toBeInstanceOf(TransferPersistenceError);
    } finally {
      await removeFailureTrigger();
    }

    expect(await financialCounts()).toEqual(before);
    await expectBalances(source.id, 1_000n, destination.id, 0n);
  });

  it('rolls back a posted transfer if its outbox insert fails', async () => {
    const source = await createWallet('outbox-failure-source');
    const destination = await createWallet('outbox-failure-destination');
    await fundWallet(source.id, '1000', 'outbox-failure');
    const before = await financialCounts();

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${OUTBOX_FAILURE_FUNCTION}"()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Deliberate Phase 2E outbox failure'; END; $$;
      CREATE TRIGGER "${OUTBOX_FAILURE_TRIGGER}"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW WHEN (NEW."event_type" = 'transfer.completed')
      EXECUTE FUNCTION "${OUTBOX_FAILURE_FUNCTION}"();
    `);
    try {
      await expect(
        transfers.execute({
          amountMinor: '250',
          destinationWalletId: destination.id,
          sourceWalletId: source.id,
        }),
      ).rejects.toBeInstanceOf(TransferPersistenceError);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "${OUTBOX_FAILURE_TRIGGER}" ON "outbox_events";
        DROP FUNCTION IF EXISTS "${OUTBOX_FAILURE_FUNCTION}"();
      `);
    }

    expect(await financialCounts()).toEqual(before);
    await expectBalances(source.id, 1_000n, destination.id, 0n);
  });

  it('rejects nonexistent wallets without creating financial writes', async () => {
    const source = await createWallet('missing-source');
    const before = await financialCounts();

    await expect(
      transfers.execute({
        amountMinor: '1',
        destinationWalletId: randomUUID(),
        sourceWalletId: source.id,
      }),
    ).rejects.toBeInstanceOf(WalletNotFoundError);

    expect(await financialCounts()).toEqual(before);
  });

  it('rejects direct balance projection updates', async () => {
    const wallet = await createWallet('projection-guard');

    await expect(
      prisma.ledgerAccount.update({
        data: { cachedBalanceMinor: { increment: 1n } },
        where: { walletId: wallet.id },
      }),
    ).rejects.toThrow(
      'Ledger account balances may only be changed by posting a journal',
    );
    await expectBalances(wallet.id, 0n);
  });

  async function createWallet(label: string) {
    return wallets.create({
      ownerReference: `test-phase1d-${label}-${randomUUID()}`,
    });
  }

  async function fundWallet(
    walletId: string,
    amountMinor: string,
    label: string,
  ): Promise<void> {
    await ledger.postDevelopmentOpeningFunding({
      amountMinor: BigInt(amountMinor),
      externalReference: `phase1d:${label}:${randomUUID()}`,
      walletId,
    });
  }

  async function expectBalances(
    firstWalletId: string,
    firstBalance: bigint,
    secondWalletId?: string,
    secondBalance?: bigint,
  ): Promise<void> {
    const walletIds = secondWalletId
      ? [firstWalletId, secondWalletId]
      : [firstWalletId];
    const accounts = await prisma.ledgerAccount.findMany({
      select: { cachedBalanceMinor: true, walletId: true },
      where: { walletId: { in: walletIds } },
    });
    const balances = new Map(
      accounts.map((account) => [account.walletId, account.cachedBalanceMinor]),
    );

    expect(balances.get(firstWalletId)).toBe(firstBalance);
    if (secondWalletId && secondBalance !== undefined) {
      expect(balances.get(secondWalletId)).toBe(secondBalance);
    }
  }

  async function financialCounts() {
    const [transfersCount, journalsCount, entriesCount, outboxRows] =
      await Promise.all([
        prisma.transfer.count(),
        prisma.ledgerTransaction.count({
          where: { type: LedgerTransactionType.TRANSFER },
        }),
        prisma.ledgerEntry.count({
          where: { transaction: { type: LedgerTransactionType.TRANSFER } },
        }),
        prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "outbox_events"
        WHERE "event_type" = 'transfer.completed'
      `,
      ]);

    return {
      entriesCount,
      journalsCount,
      outboxCount: Number(outboxRows[0]?.count),
      transfersCount,
    };
  }

  async function installFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${FAILURE_FUNCTION}"()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Deliberate Phase 1D integration failure';
      END;
      $$;

      CREATE TRIGGER "${FAILURE_TRIGGER}"
      BEFORE UPDATE ON "transfers"
      FOR EACH ROW
      WHEN (NEW."status" = 'completed')
      EXECUTE FUNCTION "${FAILURE_FUNCTION}"();
    `);
  }

  async function removeFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS "${FAILURE_TRIGGER}" ON "transfers";
      DROP FUNCTION IF EXISTS "${FAILURE_FUNCTION}"();
    `);
  }
});
