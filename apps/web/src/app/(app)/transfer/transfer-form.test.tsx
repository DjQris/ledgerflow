import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/hooks', () => ({ useCurrentUser: vi.fn() }));
vi.mock('@/lib/customer/hooks', () => ({
  useWallets: vi.fn(),
  useCustomerTransfer: vi.fn(),
}));

import { useCurrentUser } from '@/lib/auth/hooks';
import { useCustomerTransfer, useWallets } from '@/lib/customer/hooks';
import { TransferRequestError } from '@/lib/customer/transfer-client';
import { TransferForm } from './transfer-form';

const userId = 'a5e0df47-36f4-4314-8a04-71464ba8996c';
const sourceWalletId = '7c177354-8482-4fe5-a781-1174a9447b0e';
const destinationWalletId = '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f';
const transferId = 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb';
const result = {
  amountMinor: '100050',
  completedAt: '2026-10-21T17:00:00.000Z',
  destinationBalanceMinor: '100050',
  destinationWalletId,
  journalId: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
  sourceBalanceMinor: '9999950',
  sourceWalletId,
  status: 'COMPLETED' as const,
  transferId,
};
const customer = {
  id: userId,
  email: 'owner@example.test',
  role: 'CUSTOMER' as const,
  status: 'ACTIVE' as const,
};
const wallet = {
  id: sourceWalletId,
  balanceMinor: '500000',
  currency: 'NGN' as const,
  ownerReference: 'owner',
  status: 'ACTIVE',
  createdAt: '2026-10-21T17:00:00.000Z',
  updatedAt: '2026-10-21T17:00:00.000Z',
};
const mockUser = vi.mocked(useCurrentUser);
const mockWallets = vi.mocked(useWallets);
const mockTransfer = vi.mocked(useCustomerTransfer);

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

async function fillValidForm() {
  render(<TransferForm />);
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText('Recipient wallet ID'),
    destinationWalletId,
  );
  await user.type(screen.getByLabelText('Amount'), '1000.50');
  await user.click(screen.getByRole('button', { name: 'Review transfer' }));
  await screen.findByText('Amount to send');
  return user;
}

describe('secure customer transfer form', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockUser.mockReturnValue({ data: customer } as ReturnType<
      typeof useCurrentUser
    >);
    mockWallets.mockReturnValue({
      data: [wallet],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useWallets>);
    mockTransfer.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(result),
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
  });

  it('reviews exact kobo, confirms once, and shows only the confirmed result', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(result);
    mockTransfer.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
    const user = await fillValidForm();
    expect(screen.getByText('₦1,000.50')).toBeInTheDocument();
    expect(screen.getByText(destinationWalletId)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send transfer' }));
    await screen.findByText('Transfer successful');
    const [intent] = mutateAsync.mock.calls[0];
    expect(intent).toMatchObject({
      ownerUserId: userId,
      sourceWalletId,
      destinationWalletId,
      amountMinor: '100050',
    });
    expect(intent.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(screen.getByText(transferId)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View transaction details' }),
    ).toHaveAttribute('href', `/transactions?transferId=${transferId}`);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('rejects self-transfer and amounts above the live source balance before review', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(result);
    mockTransfer.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
    const user = userEvent.setup();
    render(<TransferForm />);
    await user.type(
      await screen.findByLabelText('Recipient wallet ID'),
      sourceWalletId,
    );
    await user.type(screen.getByLabelText('Amount'), '1.00');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(
      await screen.findByText(
        'Choose a recipient wallet different from the source.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Amount to send')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Recipient wallet ID'));
    await user.type(
      screen.getByLabelText('Recipient wallet ID'),
      destinationWalletId,
    );
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '5000.01');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(
      await screen.findByText(
        'Amount is greater than the selected wallet’s available balance.',
      ),
    ).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('persists and retries an unknown outcome with the exact same intent and idempotency key', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValueOnce(
        new TransferRequestError(
          'Outcome not confirmed.',
          'unknown',
          'TRANSFER_OUTCOME_UNKNOWN',
          503,
        ),
      )
      .mockResolvedValueOnce(result);
    mockTransfer.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send transfer' }));
    await screen.findByText('Outcome not confirmed.');
    const persisted = JSON.parse(
      window.sessionStorage.getItem(`ledgerflow-transfer-pending:${userId}`) ??
        'null',
    );
    expect(persisted).toMatchObject({
      amountMinor: '100050',
      destinationWalletId,
      sourceWalletId,
    });
    await user.click(
      screen.getByRole('button', {
        name: 'Verify / retry this transfer safely',
      }),
    );
    await screen.findByText('Transfer successful');
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1][0]).toEqual(mutateAsync.mock.calls[0][0]);
    expect(
      window.sessionStorage.getItem(`ledgerflow-transfer-pending:${userId}`),
    ).toBeNull();
  });

  it('prevents repeat submission while a transfer is in flight', async () => {
    const mutateAsync = vi.fn(() => new Promise(() => {}));
    mockTransfer.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send transfer' }));
    expect(
      await screen.findByText(
        'Submitting securely. Keep this page open while the result is confirmed.',
      ),
    ).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Send transfer' }),
    ).not.toBeInTheDocument();
  });

  it('restores a pending intent after refresh without generating a new key', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(result);
    mockTransfer.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
    const savedIntent = {
      ownerUserId: userId,
      sourceWalletId,
      destinationWalletId,
      amountMinor: '100050',
      amountNgn: '1000.50',
      idempotencyKey: '9e0e28af-b799-472a-8ef0-b3b8dbeb8fc1',
      createdAt: '2026-10-21T17:00:00.000Z',
    };
    window.sessionStorage.setItem(
      `ledgerflow-transfer-pending:${userId}`,
      JSON.stringify(savedIntent),
    );
    const user = userEvent.setup();
    render(<TransferForm />);
    await screen.findByText(
      /A previous transfer attempt has an unknown outcome/,
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Verify / retry this transfer safely',
      }),
    );
    await screen.findByText('Transfer successful');
    expect(mutateAsync).toHaveBeenCalledWith(savedIntent);
  });

  it('keeps the form available and presents the safe backend rejection reason', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new TransferRequestError(
          'The selected wallet does not have enough available funds.',
          'failed',
          'INSUFFICIENT_FUNDS',
          409,
        ),
      );
    mockTransfer.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCustomerTransfer>);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await user.click(screen.getByRole('button', { name: 'Send transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The selected wallet does not have enough available funds.',
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review transfer' }),
      ).toBeInTheDocument(),
    );
    expect(window.sessionStorage.length).toBe(0);
  });
});
