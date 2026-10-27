import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./transfer-client', () => ({ submitCustomerTransfer: vi.fn() }));

import { submitCustomerTransfer } from './transfer-client';
import { useCustomerTransfer } from './hooks';
import type {
  CustomerTransferIntent,
  CustomerTransferResult,
} from './wallet-types';

const submit = vi.mocked(submitCustomerTransfer);
const intent: CustomerTransferIntent = {
  ownerUserId: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
  sourceWalletId: '7c177354-8482-4fe5-a781-1174a9447b0e',
  destinationWalletId: '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f',
  amountMinor: '100050',
  amountNgn: '1000.50',
  idempotencyKey: '9e0e28af-b799-472a-8ef0-b3b8dbeb8fc1',
  createdAt: '2026-10-21T17:00:00.000Z',
};
const result: CustomerTransferResult = {
  amountMinor: '100050',
  completedAt: '2026-10-21T17:00:00.000Z',
  destinationBalanceMinor: '100050',
  destinationWalletId: intent.destinationWalletId,
  journalId: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
  sourceBalanceMinor: '9999950',
  sourceWalletId: intent.sourceWalletId,
  status: 'COMPLETED',
  transferId: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb',
};

describe('useCustomerTransfer', () => {
  beforeEach(() => submit.mockReset());

  it('invalidates wallet balances and transaction history only after confirmed success', async () => {
    submit.mockResolvedValue(result);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    const { result: hook } = renderHook(() => useCustomerTransfer(), {
      wrapper: Wrapper,
    });
    await expect(hook.current.mutateAsync(intent)).resolves.toEqual(result);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['customer', 'wallets'],
      }),
    );
    expect(submit).toHaveBeenCalledWith(intent);
    queryClient.clear();
  });

});
