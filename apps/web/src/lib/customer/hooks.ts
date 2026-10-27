'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCustomerWallets, getWalletTransactions } from './client';
import { customerKeys } from './wallet-types';
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
      ? customerKeys.transactions(walletId, 5)
      : ['customer', 'wallets', 'no-selection', 'transactions'],
    queryFn: () => {
      if (!walletId) throw new Error('A wallet must be selected');
      return getWalletTransactions(walletId, 5);
    },
    enabled: Boolean(walletId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
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
