'use client';

import { ApiError, refreshSession } from '@/lib/auth/client';
import type {
  CustomerWallet,
  TransactionHistoryFilters,
  WalletTransactionHistory,
  CustomerTransactionDetails,
} from './wallet-types';

async function customerRequest<T>(path: string, mayRefresh = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      503,
      'Service is temporarily unavailable. Please try again.',
    );
  }
  if (response.status === 401 && mayRefresh) {
    try {
      await refreshSession();
      return customerRequest<T>(path, false);
    } catch {
      throw new ApiError(401, 'Your session has ended. Please sign in again.');
    }
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'The request could not be completed.';
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export function getCustomerWallets() {
  return customerRequest<CustomerWallet[]>('/api/customer/wallets');
}

export function getWalletTransactions(
  walletId: string,
  filters: TransactionHistoryFilters,
) {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    sort: filters.sort ?? 'desc',
  });
  for (const key of [
    'reference',
    'from',
    'to',
    'status',
    'direction',
  ] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  return customerRequest<WalletTransactionHistory>(
    `/api/customer/wallets/${encodeURIComponent(walletId)}/transactions?${query}`,
  );
}

export function getTransactionDetails(transactionId: string) {
  return customerRequest<CustomerTransactionDetails>(
    `/api/customer/transactions/${encodeURIComponent(transactionId)}`,
  );
}
