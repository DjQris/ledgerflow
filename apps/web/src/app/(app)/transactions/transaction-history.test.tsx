import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, useWallets, useTransactionHistory, search } = vi.hoisted(() => ({
  push: vi.fn(),
  useWallets: vi.fn(),
  useTransactionHistory: vi.fn(),
  search: { current: new URLSearchParams() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/transactions',
  useSearchParams: () => search.current,
}));
vi.mock('@/lib/customer/hooks', () => ({ useWallets, useTransactionHistory }));

import { TransactionHistory } from './transaction-history';

const walletId = '7c177354-8482-4fe5-a781-1174a9447b0e';
const journalId = 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022';

describe('TransactionHistory', () => {
  beforeEach(() => {
    push.mockReset();
    search.current = new URLSearchParams(`walletId=${walletId}`);
    useWallets.mockReturnValue({
      data: [{ id: walletId, currency: 'NGN' }],
      isPending: false,
      isError: false,
    });
    useTransactionHistory.mockReturnValue({
      data: {
        data: [
          {
            id: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb',
            transactionId: journalId,
            amountMinor: '-1200',
            direction: 'OUTGOING',
            type: 'TRANSFER',
            status: 'COMPLETED',
            createdAt: '2026-10-21T17:00:00.000Z',
            postedAt: '2026-10-21T17:00:00.000Z',
            description: null,
            externalReference: 'ref-123',
            counterpartyWalletId: null,
          },
        ],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
  });
  afterEach(cleanup);

  it('renders a transaction table, mobile card layout, and details link', () => {
    const { container } = render(<TransactionHistory />);
    expect(screen.getAllByText('ref-123')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      `/transactions/${journalId}?walletId=${walletId}`,
    );
    expect(
      container.querySelector('.hidden.overflow-x-auto'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('.grid.gap-3.md\\:hidden'),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 transaction · page 1 of 1/)).toBeInTheDocument();
  });

  it('submits reference filters into URL state and sends them to the query hook', async () => {
    const user = userEvent.setup();
    render(<TransactionHistory />);
    await user.type(
      screen.getByRole('textbox', { name: 'Reference' }),
      'ref-123',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(push).toHaveBeenCalledWith(
      `/transactions?walletId=${walletId}&reference=ref-123`,
      { scroll: false },
    );
    expect(useTransactionHistory).toHaveBeenCalledWith(
      walletId,
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it('keeps pagination in URL navigation state', async () => {
    const user = userEvent.setup();
    useTransactionHistory.mockReturnValue({
      data: {
        data: [
          {
            id: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb',
            transactionId: journalId,
            amountMinor: '1200',
            direction: 'INCOMING',
            type: 'TRANSFER',
            status: 'COMPLETED',
            createdAt: '2026-10-21T17:00:00.000Z',
            postedAt: null,
            description: null,
            externalReference: null,
            counterpartyWalletId: null,
          },
        ],
        pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
      },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    render(<TransactionHistory />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(push).toHaveBeenCalledWith(
      `/transactions?walletId=${walletId}&page=2`,
      { scroll: false },
    );
  });
});
