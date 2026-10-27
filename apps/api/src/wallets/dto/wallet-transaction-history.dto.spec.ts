import {
  LedgerTransactionStatus,
  LedgerTransactionType,
  TransferStatus,
} from '../../generated/prisma/enums';
import {
  WalletTransactionResponseDto,
  type WalletEntryForResponse,
} from './wallet-transaction-history.dto';

const walletId = '7c177354-8482-4fe5-a781-1174a9447b0e';
const otherWalletId = '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f';

function record(amountMinor: bigint): WalletEntryForResponse {
  return {
    account: { walletId },
    amountMinor,
    createdAt: new Date('2026-10-21T17:00:00.000Z'),
    description: null,
    id: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb',
    transaction: {
      externalReference: null,
      id: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
      postedAt: new Date('2026-10-21T17:00:00.000Z'),
      status: LedgerTransactionStatus.POSTED,
      type: LedgerTransactionType.TRANSFER,
      transfer: {
        sourceWalletId: otherWalletId,
        destinationWalletId: walletId,
        status: TransferStatus.COMPLETED,
      },
    },
  };
}

describe('WalletTransactionResponseDto', () => {
  it('serializes signed exact amounts and derives incoming transfer counterparty', () => {
    expect(
      WalletTransactionResponseDto.fromRecord(record(9_007_199_254_740_993n)),
    ).toMatchObject({
      amountMinor: '9007199254740993',
      counterpartyWalletId: otherWalletId,
      direction: 'INCOMING',
      status: 'COMPLETED',
      type: 'TRANSFER',
    });
  });

  it('derives outgoing direction from the signed ledger entry', () => {
    const outgoing = record(-1200n);
    outgoing.transaction.transfer = {
      sourceWalletId: walletId,
      destinationWalletId: otherWalletId,
      status: TransferStatus.COMPLETED,
    };
    expect(WalletTransactionResponseDto.fromRecord(outgoing)).toMatchObject({
      amountMinor: '-1200',
      counterpartyWalletId: otherWalletId,
      direction: 'OUTGOING',
    });
  });

  it('does not invent a counterparty for non-transfer entries', () => {
    const funding = record(500n);
    funding.transaction.transfer = null;
    expect(WalletTransactionResponseDto.fromRecord(funding)).toMatchObject({
      counterpartyWalletId: null,
      direction: 'INCOMING',
    });
  });
});
