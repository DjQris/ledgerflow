import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidTransferError,
  SelfTransferError,
} from './errors/transfer.errors';
import { TransfersService } from './transfers.service';

const SOURCE_WALLET_ID = '7c177354-8482-4fe5-a781-1174a9447b0e';
const DESTINATION_WALLET_ID = '5ad244aa-f5f1-4560-8a5b-4a4be9684e58';

describe('TransfersService command validation', () => {
  it.each(['0', '-1', '1.5', '01', '1e3', ''])(
    'rejects invalid amount %p before opening a transaction',
    async (amountMinor) => {
      const transactionMock = jest.fn();
      const service = new TransfersService({
        $transaction: transactionMock,
      } as unknown as PrismaService);

      await expect(
        service.execute({
          amountMinor,
          destinationWalletId: DESTINATION_WALLET_ID,
          sourceWalletId: SOURCE_WALLET_ID,
        }),
      ).rejects.toBeInstanceOf(InvalidTransferError);
      expect(transactionMock).not.toHaveBeenCalled();
    },
  );

  it('rejects self-transfers before opening a transaction', async () => {
    const transactionMock = jest.fn();
    const service = new TransfersService({
      $transaction: transactionMock,
    } as unknown as PrismaService);

    await expect(
      service.execute({
        amountMinor: '1',
        destinationWalletId: SOURCE_WALLET_ID,
        sourceWalletId: SOURCE_WALLET_ID,
      }),
    ).rejects.toBeInstanceOf(SelfTransferError);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
