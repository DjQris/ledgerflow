'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCustomerWallets,
  getTransactionDetails,
  getWalletTransactions,
} from './client';
import { customerKeys, type TransactionHistoryFilters } from './wallet-types';
import { submitCustomerTransfer } from './transfer-client';
import type { CustomerTransferIntent } from './wallet-types';

export function useWallets() {
  return useQuery({
    queryKey: customerKeys.wallets,
    queryFn: getCustomerWallets,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useRecentTransactions(walletId: string | undefined) {
  return useQuery({
    queryKey: walletId
      ? customerKeys.transactions(walletId, { page: 1, pageSize: 5 })
      : ['customer', 'wallets', 'no-selection', 'transactions'],
    queryFn: () => {
      if (!walletId) throw new Error('A wallet must be selected');
      return getWalletTransactions(walletId, { page: 1, pageSize: 5 });
    },
    enabled: Boolean(walletId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useTransactionHistory(
  walletId: string | undefined,
  filters: TransactionHistoryFilters,
) {
  return useQuery({
    queryKey: walletId
      ? customerKeys.transactions(walletId, filters)
      : ['customer', 'transactions', 'no-wallet', filters],
    queryFn: () => {
      if (!walletId) throw new Error('A wallet must be selected');
      return getWalletTransactions(walletId, filters);
    },
    enabled: Boolean(walletId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useTransactionDetails(transactionId: string | undefined) {
  return useQuery({
    queryKey: transactionId
      ? customerKeys.transactionDetails(transactionId)
      : ['customer', 'transactions', 'no-selection'],
    queryFn: () => {
      if (!transactionId) throw new Error('A transaction must be selected');
      return getTransactionDetails(transactionId);
    },
    enabled: Boolean(transactionId),
    staleTime: 15_000,
  });
}

export function useCustomerTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (intent: CustomerTransferIntent) =>
      submitCustomerTransfer(intent),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['customer', 'wallets'],
      });
    },
  });
}
