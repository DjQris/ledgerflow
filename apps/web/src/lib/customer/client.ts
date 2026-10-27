'use client';

import { ApiError, refreshSession } from '@/lib/auth/client';
import type { CustomerWallet, WalletTransactionHistory } from './wallet-types';

async function customerRequest<T>(path: string, mayRefresh = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(503, 'Service is temporarily unavailable. Please try again.');
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
    const message = payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'The request could not be completed.';
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export function getCustomerWallets() {
  return customerRequest<CustomerWallet[]>('/api/customer/wallets');
}

export function getWalletTransactions(walletId: string, pageSize = 5) {
  const query = new URLSearchParams({ page: '1', pageSize: String(pageSize) });
  return customerRequest<WalletTransactionHistory>(
    `/api/customer/wallets/${encodeURIComponent(walletId)}/transactions?${query}`,
  );
}
