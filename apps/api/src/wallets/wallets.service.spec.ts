import { WalletStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from './wallets.service';

const CREATED_AT = new Date('2026-10-21T17:00:00.000Z');
const WALLET_ID = '7c177354-8482-4fe5-a781-1174a9447b0e';

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
      wallet: { create: jest.fn().mockResolvedValue(walletRecord(0n)) },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new WalletsService(prisma);

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
        }) as object,
      }),
    );
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
    const service = new WalletsService(prisma);

    const result = await service.findOne(WALLET_ID);

    expect(result.balanceMinor).toBe('9007199254740993');
  });
});
