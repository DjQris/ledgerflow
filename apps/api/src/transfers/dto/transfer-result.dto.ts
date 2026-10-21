import { TransferStatus } from '../../generated/prisma/enums';

export interface TransferResult {
  amountMinor: string;
  completedAt: string;
  destinationBalanceMinor: string;
  destinationWalletId: string;
  journalId: string;
  sourceBalanceMinor: string;
  sourceWalletId: string;
  status: TransferStatus;
  transferId: string;
}
