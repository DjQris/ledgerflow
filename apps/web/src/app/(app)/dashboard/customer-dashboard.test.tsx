import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/hooks', () => ({ useCurrentUser: vi.fn() }));
vi.mock('@/lib/customer/hooks', () => ({ useWallets: vi.fn(), useRecentTransactions: vi.fn() }));

import { useCurrentUser } from '@/lib/auth/hooks';
import { useRecentTransactions, useWallets } from '@/lib/customer/hooks';
import { CustomerDashboard } from './customer-dashboard';

const id1 = '7c177354-8482-4fe5-a781-1174a9447b0e';
const id2 = '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f';
const wallet = (id: string, balanceMinor: string) => ({
  id, balanceMinor, currency: 'NGN' as const, ownerReference: 'customer-ref', status: 'ACTIVE',
  createdAt: '2026-10-21T17:00:00.000Z', updatedAt: '2026-10-21T17:00:00.000Z',
});

const mockUser = vi.mocked(useCurrentUser);
const mockWallets = vi.mocked(useWallets);
const mockTransactions = vi.mocked(useRecentTransactions);

describe('customer dashboard', () => {
  beforeEach(() => {
    mockUser.mockReturnValue({ data: { id: 'user-1', email: 'customer@example.com', role: 'CUSTOMER', status: 'ACTIVE' } } as ReturnType<typeof useCurrentUser>);
    mockWallets.mockReturnValue({ data: [wallet(id1, '9007199254740993')], dataUpdatedAt: Date.parse('2026-10-21T17:00:00.000Z'), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useWallets>);
    mockTransactions.mockReturnValue({
      data: { data: [{
        id: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb', transactionId: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
        amountMinor: '-12345', direction: 'OUTGOING', counterpartyWalletId: id2, createdAt: '2026-10-21T17:00:00.000Z',
        postedAt: '2026-10-21T17:00:00.000Z', description: null, externalReference: null, status: 'POSTED', type: 'TRANSFER',
      }], pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 } },
      isPending: false, isError: false, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecentTransactions>);
  });

  it('shows backend owner, exact balance, posted activity and real action links', () => {
    render(<CustomerDashboard />);
    expect(screen.getByText('customer@example.com')).toBeInTheDocument();
    expect(screen.getByText('₦90,071,992,547,409.93')).toBeInTheDocument();
    expect(screen.getByText('To wallet ••DF7F')).toBeInTheDocument();
    expect(screen.getByText('POSTED')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Make a transfer/ })).toHaveAttribute('href', '/transfer');
    expect(screen.getByRole('link', { name: /Wallet details/ })).toHaveAttribute('href', '/wallets');
    expect(screen.getByRole('link', { name: /View transactions/ })).toHaveAttribute('href', '/transactions');
  });

  it('offers a selector when the customer owns multiple wallets', () => {
    mockWallets.mockReturnValue({ data: [wallet(id1, '100'), wallet(id2, '200')], dataUpdatedAt: Date.now(), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useWallets>);
    render(<CustomerDashboard />);
    const selector = screen.getByLabelText('Choose wallet');
    fireEvent.change(selector, { target: { value: id2 } });
    expect(mockTransactions).toHaveBeenLastCalledWith(id2);
    expect(screen.getByText('₦3.00')).toBeInTheDocument();
  });

  it('handles loading, empty wallet, and transaction error states without showing fixture data', () => {
    mockWallets.mockReturnValue({ data: undefined, dataUpdatedAt: 0, isPending: true, isError: false, isFetching: true, refetch: vi.fn() } as unknown as ReturnType<typeof useWallets>);
    const loading = render(<CustomerDashboard />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    loading.unmount();

    mockWallets.mockReturnValue({ data: [], dataUpdatedAt: Date.now(), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useWallets>);
    const empty = render(<CustomerDashboard />);
    expect(screen.getByText('No wallet yet')).toBeInTheDocument();
    expect(screen.queryByText('₦1,234,567.89')).not.toBeInTheDocument();
    empty.unmount();

    mockWallets.mockReturnValue({ data: [wallet(id1, '0')], dataUpdatedAt: Date.now(), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useWallets>);
    mockTransactions.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useRecentTransactions>);
    render(<CustomerDashboard />);
    expect(screen.getByText('Transactions could not be loaded')).toBeInTheDocument();
  });
});
