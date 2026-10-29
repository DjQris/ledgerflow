import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/backend', () => ({
  backendRequest: vi.fn(),
  currentSession: vi.fn(),
}));

import { backendRequest, currentSession } from '@/lib/auth/backend';
import {
  handleCustomerTransactionDetails,
  handleCustomerTransactions,
  handleCustomerWallets,
} from './bff';

const mockBackend = vi.mocked(backendRequest);
const mockSession = vi.mocked(currentSession);
const walletId = '7c177354-8482-4fe5-a781-1174a9447b0e';
const customer = {
  id: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
  email: 'owner@example.com',
  role: 'CUSTOMER' as const,
  status: 'ACTIVE' as const,
};

describe('customer wallet BFF', () => {
  beforeEach(() => {
    mockBackend.mockReset();
    mockSession.mockReset();
  });

  it('blocks non-customer roles before requesting the broad wallet list', async () => {
    mockSession.mockResolvedValue({
      status: 200,
      profile: { ...customer, role: 'OPERATIONS' },
    });
    const response = await handleCustomerWallets();
    expect(response.status).toBe(403);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('returns only whitelisted wallet fields and exact string balances', async () => {
    mockSession.mockResolvedValue({ status: 200, profile: customer });
    mockBackend.mockResolvedValueOnce(
      Response.json([
        {
          id: walletId,
          ownerReference: 'customer-ref',
          status: 'ACTIVE',
          currency: 'NGN',
          balanceMinor: '9007199254740993',
          createdAt: '2026-10-21T17:00:00.000Z',
          updatedAt: '2026-10-21T17:00:00.000Z',
          privateField: 'must not pass through',
        },
      ]),
    );
    const response = await handleCustomerWallets();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body[0].balanceMinor).toBe('9007199254740993');
    expect(body[0].privateField).toBeUndefined();
    expect(mockBackend).toHaveBeenCalledWith('wallets');
  });

  it('validates the history query, checks customer role, and forwards a fixed owned-wallet path', async () => {
    mockSession.mockResolvedValue({ status: 200, profile: customer });
    const invalid = await handleCustomerTransactions(
      new Request('http://local/api?admin=true'),
      walletId,
    );
    expect(invalid.status).toBe(400);
    expect(mockBackend).not.toHaveBeenCalled();

    mockBackend.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            id: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb',
            transactionId: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
            type: 'TRANSFER',
            status: 'POSTED',
            amountMinor: '-1200',
            direction: 'OUTGOING',
            counterpartyWalletId: '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f',
            description: null,
            externalReference: null,
            createdAt: '2026-10-21T17:00:00.000Z',
            postedAt: null,
            leaked: 'not allowed',
          },
        ],
        pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
        privateField: 'not allowed',
      }),
    );
    const response = await handleCustomerTransactions(
      new Request('http://local/api'),
      walletId,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].amountMinor).toBe('-1200');
    expect(body.data[0].leaked).toBeUndefined();
    expect(body.privateField).toBeUndefined();
    expect(mockBackend).toHaveBeenCalledWith(
      `wallets/${walletId}/transactions?page=1&pageSize=20&sort=desc`,
    );
  });

  it('validates and forwards only supported history filters', async () => {
    mockSession.mockResolvedValue({ status: 200, profile: customer });
    mockBackend.mockResolvedValueOnce(
      Response.json({
        data: [],
        pagination: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
      }),
    );
    const response = await handleCustomerTransactions(
      new Request(
        `http://local/api?page=2&reference=abc&from=2026-10-01&to=2026-10-31&status=COMPLETED&direction=INCOMING&sort=asc`,
      ),
      walletId,
    );
    expect(response.status).toBe(200);
    expect(mockBackend).toHaveBeenCalledWith(
      `wallets/${walletId}/transactions?page=2&pageSize=20&sort=asc&reference=abc&from=2026-10-01&to=2026-10-31&status=COMPLETED&direction=INCOMING`,
    );
    expect(
      (
        await handleCustomerTransactions(
          new Request('http://local/api?status=UNKNOWN'),
          walletId,
        )
      ).status,
    ).toBe(400);
  });

  it('rejects malformed pagination and non-string minor-unit response fields', async () => {
    mockSession.mockResolvedValue({ status: 200, profile: customer });
    mockBackend.mockResolvedValueOnce(
      Response.json({
        data: [],
        pagination: { page: 1, pageSize: '20', total: 0, totalPages: 0 },
      }),
    );
    const invalidPagination = await handleCustomerTransactions(
      new Request('http://local/api'),
      walletId,
    );
    expect(invalidPagination.status).toBe(502);

    mockBackend.mockResolvedValueOnce(
      Response.json([
        {
          id: walletId,
          ownerReference: 'x',
          status: 'ACTIVE',
          currency: 'NGN',
          balanceMinor: 9007199254740993,
          createdAt: '2026-10-21T17:00:00.000Z',
          updatedAt: '2026-10-21T17:00:00.000Z',
        },
      ]),
    );
    expect((await handleCustomerWallets()).status).toBe(502);
  });

  it('checks customer role and allowlists customer-safe transaction detail fields', async () => {
    mockSession.mockResolvedValue({
      status: 200,
      profile: { ...customer, role: 'OPERATIONS' },
    });
    expect(
      (
        await handleCustomerTransactionDetails(
          'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
        )
      ).status,
    ).toBe(403);
    expect(mockBackend).not.toHaveBeenCalled();
    mockSession.mockResolvedValue({ status: 200, profile: customer });
    mockBackend.mockResolvedValueOnce(
      Response.json({
        id: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
        amountMinor: '1200',
        currency: 'NGN',
        type: 'TRANSFER',
        status: 'COMPLETED',
        createdAt: '2026-10-21T17:00:00.000Z',
        postedAt: null,
        description: null,
        externalReference: null,
        walletId,
        sourceWalletId: walletId,
        destinationWalletId: '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f',
        auditMetadata: { secret: true },
      }),
    );
    const response = await handleCustomerTransactionDetails(
      'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('auditMetadata');
    expect(mockBackend).toHaveBeenCalledWith(
      'transactions/c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
    );
  });

  it('rejects malformed identifiers, foreign currencies, and unsafe monetary values', async () => {
    expect(
      (
        await handleCustomerTransactions(
          new Request('http://local'),
          'not-a-uuid',
        )
      ).status,
    ).toBe(400);
    mockSession.mockResolvedValue({ status: 200, profile: customer });
    mockBackend.mockResolvedValueOnce(
      Response.json([
        {
          id: walletId,
          ownerReference: 'x',
          status: 'ACTIVE',
          currency: 'USD',
          balanceMinor: '10',
          createdAt: '2026-10-21T17:00:00.000Z',
          updatedAt: '2026-10-21T17:00:00.000Z',
        },
      ]),
    );
    expect((await handleCustomerWallets()).status).toBe(502);
  });
});
