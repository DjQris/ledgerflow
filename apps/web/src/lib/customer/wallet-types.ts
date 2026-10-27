export type CustomerWallet = {
  balanceMinor: string;
  createdAt: string;
  currency: 'NGN';
  id: string;
  ownerReference: string;
  status: string;
  updatedAt: string;
};

export type WalletTransaction = {
  amountMinor: string;
  counterpartyWalletId: string | null;
  createdAt: string;
  description: string | null;
  direction: 'INCOMING' | 'OUTGOING' | 'NEUTRAL';
  externalReference: string | null;
  id: string;
  postedAt: string | null;
  status: string;
  transactionId: string;
  type: string;
};

export type WalletTransactionHistory = {
  data: WalletTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type CustomerTransferIntent = {
  ownerUserId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: string;
  amountNgn: string;
  idempotencyKey: string;
  createdAt: string;
};

export type CustomerTransferResult = {
  amountMinor: string;
  completedAt: string;
  destinationBalanceMinor: string;
  destinationWalletId: string;
  journalId: string;
  sourceBalanceMinor: string;
  sourceWalletId: string;
  status: 'COMPLETED';
  transferId: string;
};

export const customerKeys = {
  wallets: ['customer', 'wallets'] as const,
  transactions: (walletId: string, pageSize: number) =>
    [
      'customer',
      'wallets',
      walletId,
      'transactions',
      { page: 1, pageSize },
    ] as const,
};
