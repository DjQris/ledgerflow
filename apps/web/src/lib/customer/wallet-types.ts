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

export type TransactionHistoryFilters = {
  page: number;
  pageSize: number;
  reference?: string;
  from?: string;
  to?: string;
  status?: string;
  direction?: string;
  sort?: 'asc' | 'desc';
};

export type CustomerTransactionDetails = {
  amountMinor: string;
  createdAt: string;
  currency: string;
  description: string | null;
  destinationWalletId: string | null;
  externalReference: string | null;
  id: string;
  postedAt: string | null;
  sourceWalletId: string | null;
  status: string;
  type: string;
  walletId: string | null;
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
  transactions: (walletId: string, filters: TransactionHistoryFilters) =>
    ['customer', 'wallets', walletId, 'transactions', filters] as const,
  transactionDetails: (transactionId: string) =>
    ['customer', 'transactions', transactionId] as const,
};
