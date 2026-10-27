import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  authRequest: vi.fn(),
  getCurrentUser: vi.fn(),
}));

import { authRequest } from './client';
import { useLogin, useLogout } from './hooks';
import { authKeys } from './types';

const customer = {
  id: 'customer-2',
  email: 'new-customer@example.test',
  role: 'CUSTOMER' as const,
  status: 'ACTIVE' as const,
};

describe('authentication query cache boundaries', () => {
  beforeEach(() => vi.mocked(authRequest).mockReset());

  it('clears private data before installing a newly authenticated identity', async () => {
    const client = new QueryClient();
    client.setQueryData(
      ['customer', 'wallets'],
      [{ id: 'previous-user-wallet' }],
    );
    client.setQueryData(
      ['operations', 'users'],
      [{ id: 'previous-user-admin-data' }],
    );
    vi.mocked(authRequest).mockResolvedValue(customer);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLogin(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        email: customer.email,
        password: 'not-a-real-password',
      });
    });

    expect(client.getQueryData(['customer', 'wallets'])).toBeUndefined();
    expect(client.getQueryData(['operations', 'users'])).toBeUndefined();
    expect(client.getQueryData(authKeys.me)).toEqual(customer);
    client.clear();
  });

  it('clears private data on logout', async () => {
    const client = new QueryClient();
    client.setQueryData(['customer', 'wallets'], [{ id: 'wallet' }]);
    vi.mocked(authRequest).mockResolvedValue(undefined);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.clear();
  });
});
