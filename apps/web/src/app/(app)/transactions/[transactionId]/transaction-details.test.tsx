import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useTransactionDetails, useSearchParams } = vi.hoisted(() => ({
  useTransactionDetails: vi.fn(),
  useSearchParams: vi.fn(),
}));
vi.mock('@/lib/customer/hooks', () => ({ useTransactionDetails }));
vi.mock('next/navigation', () => ({ useSearchParams }));

import { ApiError } from '@/lib/auth/client';
import { TransactionDetails } from './transaction-details';

const transactionId = 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022';
const walletId = '7c177354-8482-4fe5-a781-1174a9447b0e';

describe('TransactionDetails', () => {
  beforeEach(() => {
    useTransactionDetails.mockReset();
    useSearchParams.mockReturnValue(
      new URLSearchParams(`walletId=${walletId}&page=3`),
    );
  });
  afterEach(cleanup);

  it('shows customer-safe receipt fields and links back to history', () => {
    useTransactionDetails.mockReturnValue({
      data: {
        id: transactionId,
        amountMinor: '1200',
        currency: 'NGN',
        type: 'TRANSFER',
        status: 'COMPLETED',
        createdAt: '2026-10-21T17:00:00.000Z',
        postedAt: '2026-10-21T17:00:00.000Z',
        description: null,
        externalReference: 'transfer-ref',
        walletId,
        sourceWalletId: walletId,
        destinationWalletId: '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f',
      },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    render(<TransactionDetails transactionId={transactionId} />);
    expect(screen.getByText('transfer-ref')).toBeInTheDocument();
    expect(screen.getAllByText(walletId).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('link', { name: /Back to transactions/ }),
    ).toHaveAttribute('href', `/transactions?walletId=${walletId}&page=3`);
  });

  it('does not reveal whether a missing or non-owned transaction exists', () => {
    useTransactionDetails.mockReturnValue({
      error: new ApiError(404, 'The requested resource was not found.'),
      isPending: false,
      isError: true,
    });
    render(<TransactionDetails transactionId={transactionId} />);
    expect(
      screen.getByRole('heading', { name: 'Transaction not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/may not exist or may not be available/),
    ).toBeInTheDocument();
  });
});
