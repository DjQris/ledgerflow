import { AuditService } from '../audit/audit.service';
import { NotFoundException } from '@nestjs/common';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
  UserRole,
  UserStatus,
  WalletStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from './wallets.service';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';

const CREATED_AT = new Date('2026-10-21T17:00:00.000Z');
const WALLET_ID = '7c177354-8482-4fe5-a781-1174a9447b0e';
const otherWalletId = '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f';

function walletRecord(balanceMinor: bigint) {
  return {
    createdAt: CREATED_AT,
    currency: 'NGN',
    id: WALLET_ID,
    ledgerAccount: { cachedBalanceMinor: balanceMinor },
    ownerReference: 'test-alice',
    status: WalletStatus.ACTIVE,
    updatedAt: CREATED_AT,
  };
}

describe('WalletsService', () => {
  it('creates an NGN wallet and its zero-balance ledger account atomically', async () => {
    const transaction = {
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      user: { create: jest.fn().mockResolvedValue({ id: WALLET_ID }) },
      wallet: { create: jest.fn().mockResolvedValue(walletRecord(0n)) },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new WalletsService(
      prisma,
      new AuditService(prisma),
      new UsersService(),
    );

    const result = await service.create({ ownerReference: 'test-alice' });

    expect(result).toMatchObject({
      balanceMinor: '0',
      currency: 'NGN',
      ownerReference: 'test-alice',
    });
    expect(transaction.wallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currency: 'NGN',
          ledgerAccount: {
            create: expect.objectContaining({
              cachedBalanceMinor: 0n,
              currency: 'NGN',
              type: 'WALLET',
            }) as object,
          },
          ownerReference: 'test-alice',
          userId: WALLET_ID,
        }) as object,
      }),
    );
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        email: expect.stringMatching(
          /^simulated-[0-9a-f-]{36}@ledgerflow\.invalid$/,
        ) as string,
        id: expect.any(String) as string,
        role: 'CUSTOMER',
        status: 'SUSPENDED',
      },
      select: { id: true },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('returns cached balances as exact integer strings', async () => {
    const prisma = {
      wallet: {
        findUnique: jest
          .fn()
          .mockResolvedValue(walletRecord(9_007_199_254_740_993n)),
      },
    } as unknown as PrismaService;
    const service = new WalletsService(
      prisma,
      new AuditService(prisma),
      new UsersService(),
    );

    const result = await service.findOne(WALLET_ID);

    expect(result.balanceMinor).toBe('9007199254740993');
  });

  it('returns only customer-safe details for a transaction with an owned wallet entry', async () => {
    const userId = 'a5e0df47-36f4-4314-8a04-71464ba8996c';
    const transactionId = 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022';
    const findFirstMock = jest.fn().mockResolvedValue({
      id: transactionId,
      type: LedgerTransactionType.TRANSFER,
      status: LedgerTransactionStatus.POSTED,
      currency: 'NGN',
      description: 'private journal description',
      externalReference: 'transfer-reference',
      createdAt: CREATED_AT,
      postedAt: CREATED_AT,
      transfer: {
        amountMinor: 1200n,
        destinationWalletId: WALLET_ID,
        sourceWalletId: otherWalletId,
        status: 'COMPLETED',
      },
      entries: [
        {
          amountMinor: 1200n,
          createdAt: CREATED_AT,
          description: 'private entry description',
          account: { walletId: WALLET_ID, wallet: { id: WALLET_ID } },
        },
      ],
      auditEvents: [{ metadata: { secret: 'never returned' } }],
    });
    const prisma = {
      ledgerTransaction: { findFirst: findFirstMock },
    } as unknown as PrismaService;
    const service = new WalletsService(
      prisma,
      new AuditService(prisma),
      new UsersService(),
    );

    const result = await service.getTransactionDetailsForUser(transactionId, {
      id: userId,
      email: 'customer@example.com',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });

    expect(result).toEqual({
      amountMinor: '1200',
      createdAt: CREATED_AT.toISOString(),
      currency: 'NGN',
      description: null,
      destinationWalletId: WALLET_ID,
      externalReference: 'transfer-reference',
      id: transactionId,
      postedAt: CREATED_AT.toISOString(),
      sourceWalletId: otherWalletId,
      status: 'COMPLETED',
      type: 'TRANSFER',
      walletId: WALLET_ID,
    });
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('applies supported history filters before paginating on the backend', async () => {
    const findManyMock = jest.fn().mockResolvedValue([]);
    const countMock = jest.fn().mockResolvedValue(0);
    const prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: WALLET_ID,
          ledgerAccount: { id: '5ad244aa-f5f1-4560-8a5b-4a4be9684e58' },
        }),
      },
      ledgerEntry: { count: countMock, findMany: findManyMock },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const service = new WalletsService(
      prisma,
      new AuditService(prisma),
      new UsersService(),
    );
    const query = Object.assign(new WalletTransactionsQueryDto(), {
      page: 2,
      pageSize: 10,
      reference: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
      from: '2026-10-01',
      to: '2026-10-31',
      status: 'COMPLETED',
      direction: 'OUTGOING' as const,
      sort: 'asc' as const,
    });

    await service.getTransactions(WALLET_ID, query);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: 10,
        take: 10,
        // Jest partial matchers intentionally stand in for nested Prisma where clauses.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: expect.objectContaining({
          accountId: '5ad244aa-f5f1-4560-8a5b-4a4be9684e58',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          AND: expect.arrayContaining([
            {
              createdAt: {
                gte: new Date('2026-10-01'),
                lte: new Date('2026-10-31T23:59:59.999Z'),
              },
            },
            {
              OR: [
                {
                  transaction: {
                    externalReference: {
                      contains: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
                      mode: 'insensitive',
                    },
                  },
                },
                { transaction: { id: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022' } },
              ],
            },
            { transaction: { transfer: { is: { status: 'COMPLETED' } } } },
            { amountMinor: { lt: 0n } },
          ]),
        }),
      }),
    );
    expect(countMock).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ where: expect.any(Object) }),
    );
  });

  it('returns not found when a transaction has no entry visible to the customer', async () => {
    const findFirstMock = jest.fn().mockResolvedValue(null);
    const prisma = {
      ledgerTransaction: { findFirst: findFirstMock },
    } as unknown as PrismaService;
    const service = new WalletsService(
      prisma,
      new AuditService(prisma),
      new UsersService(),
    );

    await expect(
      service.getTransactionDetailsForUser(
        'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
        {
          id: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
          email: 'customer@example.com',
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
