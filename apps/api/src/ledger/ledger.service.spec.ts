import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
  WalletStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

const WALLET_ID = '7c177354-8482-4fe5-a781-1174a9447b0e';
const WALLET_ACCOUNT_ID = '5ad244aa-f5f1-4560-8a5b-4a4be9684e58';
const SYSTEM_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const JOURNAL_ID = '7f6827f9-9a4c-435e-b9cb-1bb62ae2165a';

interface TestLedgerEntry {
  accountId: string;
  amountMinor: bigint;
  description: string;
  transactionId: string;
}

function developmentConfig(): ConfigService<EnvironmentVariables, true> {
  return {
    get: jest.fn().mockReturnValue('development'),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('LedgerService', () => {
  it('rejects development funding in production before opening a transaction', async () => {
    const transactionMock = jest.fn();
    const prisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const productionConfig = {
      get: jest.fn().mockReturnValue('production'),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const service = new LedgerService(
      prisma,
      productionConfig,
      new AuditService(prisma),
    );

    await expect(
      service.postDevelopmentOpeningFunding({
        amountMinor: 500_000n,
        externalReference: 'development-opening-funding:test-ada:v1',
        walletId: WALLET_ID,
      }),
    ).rejects.toThrow('Development funding is disabled in production');
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('posts balanced opening entries before marking the journal posted', async () => {
    let createdEntries: TestLedgerEntry[] = [];
    const transaction = {
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      ledgerAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: SYSTEM_ACCOUNT_ID }),
      },
      ledgerEntry: {
        createMany: jest.fn((input: { data: TestLedgerEntry[] }) => {
          createdEntries = input.data;
          return Promise.resolve({ count: input.data.length });
        }),
      },
      ledgerTransaction: {
        create: jest.fn().mockResolvedValue({ id: JOURNAL_ID }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: JOURNAL_ID }),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          currency: 'NGN',
          id: WALLET_ID,
          ledgerAccount: { id: WALLET_ACCOUNT_ID },
          ownerReference: 'test-ada',
          status: WalletStatus.ACTIVE,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new LedgerService(
      prisma,
      developmentConfig(),
      new AuditService(prisma),
    );

    await service.postDevelopmentOpeningFunding({
      amountMinor: 500_000n,
      externalReference: 'development-opening-funding:test-ada:v1',
      walletId: WALLET_ID,
    });

    expect(createdEntries).toHaveLength(2);
    expect(
      createdEntries.reduce((total, entry) => total + entry.amountMinor, 0n),
    ).toBe(0n);
    expect(createdEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: SYSTEM_ACCOUNT_ID,
          amountMinor: -500_000n,
        }),
        expect.objectContaining({
          accountId: WALLET_ACCOUNT_ID,
          amountMinor: 500_000n,
        }),
      ]),
    );
    expect(transaction.ledgerTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LedgerTransactionStatus.PENDING,
          type: LedgerTransactionType.OPENING_FUNDING,
        }) as object,
      }),
    );
    expect(transaction.ledgerTransaction.update).toHaveBeenCalledWith({
      data: { status: LedgerTransactionStatus.POSTED },
      where: { id: JOURNAL_ID },
    });
  });

  it('reuses a matching posted opening journal on rerun', async () => {
    const transaction = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          currency: 'NGN',
          entries: [
            { accountId: SYSTEM_ACCOUNT_ID, amountMinor: -500_000n },
            { accountId: WALLET_ACCOUNT_ID, amountMinor: 500_000n },
          ],
          id: JOURNAL_ID,
          status: LedgerTransactionStatus.POSTED,
          type: LedgerTransactionType.OPENING_FUNDING,
        }),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          currency: 'NGN',
          id: WALLET_ID,
          ledgerAccount: { id: WALLET_ACCOUNT_ID },
          ownerReference: 'test-ada',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new LedgerService(
      prisma,
      developmentConfig(),
      new AuditService(prisma),
    );

    const result = await service.postDevelopmentOpeningFunding({
      amountMinor: 500_000n,
      externalReference: 'development-opening-funding:test-ada:v1',
      walletId: WALLET_ID,
    });

    expect(result).toEqual({
      amountMinor: '500000',
      journalId: JOURNAL_ID,
      walletId: WALLET_ID,
    });
  });
});
