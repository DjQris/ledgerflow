import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/backend', () => ({
  backendRequest: vi.fn(),
  currentSession: vi.fn(),
}));

import { backendRequest, currentSession } from '@/lib/auth/backend';
import { handleCustomerTransfer } from './transfer-bff';

const mockBackend = vi.mocked(backendRequest);
const mockSession = vi.mocked(currentSession);
const customer = {
  id: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
  email: 'owner@example.test',
  role: 'CUSTOMER' as const,
  status: 'ACTIVE' as const,
};
const sourceWalletId = '7c177354-8482-4fe5-a781-1174a9447b0e';
const destinationWalletId = '98c13020-56b4-4c8e-8dd0-c0ab6b72df7f';
const key = '9e0e28af-b799-472a-8ef0-b3b8dbeb8fc1';
const csrf = `${'A'.repeat(43)}.${'a'.repeat(64)}`;
const result = {
  amountMinor: '100050',
  completedAt: '2026-10-21T17:00:00.000Z',
  destinationBalanceMinor: '100050',
  destinationWalletId,
  journalId: 'c74f7a88-6aa0-40d2-8d71-b6411d8f9022',
  sourceBalanceMinor: '9999950',
  sourceWalletId,
  status: 'COMPLETED',
  transferId: 'b7220f85-c8f7-430b-85c3-d9a6f17fe3fb',
};

function post(
  body: unknown = {
    sourceWalletId,
    destinationWalletId,
    amountMinor: '100050',
  },
  options: { origin?: string; key?: string } = {},
): Request {
  return new Request('http://localhost:3001/api/customer/transfers', {
    method: 'POST',
    headers: {
      origin: options.origin ?? 'http://localhost:3001',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'idempotency-key': options.key ?? key,
    },
    body: JSON.stringify(body),
  });
}

describe('customer transfer BFF', () => {
  beforeEach(() => {
    mockBackend.mockReset();
    mockSession.mockReset();
    mockSession.mockResolvedValue({ status: 200, profile: customer });
  });

  it('rejects foreign and missing origins before reading identity or calling the API', async () => {
    expect(
      (
        await handleCustomerTransfer(
          post(undefined, { origin: 'https://attacker.test' }),
        )
      ).status,
    ).toBe(403);
    const missing = new Request(
      'http://localhost:3001/api/customer/transfers',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({
          sourceWalletId,
          destinationWalletId,
          amountMinor: '100050',
        }),
      },
    );
    expect((await handleCustomerTransfer(missing)).status).toBe(403);
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it.each([
    [
      {
        sourceWalletId,
        destinationWalletId,
        amountMinor: '100050',
        description: 'not supported',
      },
      key,
    ],
    [
      { sourceWalletId, destinationWalletId: sourceWalletId, amountMinor: '1' },
      key,
    ],
    [
      {
        sourceWalletId,
        destinationWalletId,
        amountMinor: '9223372036854775808',
      },
      key,
    ],
    [{ sourceWalletId, destinationWalletId, amountMinor: '0' }, key],
    [{ sourceWalletId, destinationWalletId, amountMinor: '100050' }, 'bad-key'],
  ])(
    'rejects malformed transfer fields and key before forwarding',
    async (body, idempotencyKey) => {
      expect(
        (await handleCustomerTransfer(post(body, { key: idempotencyKey })))
          .status,
      ).toBe(400);
      expect(mockSession).not.toHaveBeenCalled();
      expect(mockBackend).not.toHaveBeenCalled();
    },
  );

  it('blocks non-customer roles before any transfer API call', async () => {
    mockSession.mockResolvedValue({
      status: 200,
      profile: { ...customer, role: 'OPERATIONS' },
    });
    expect((await handleCustomerTransfer(post())).status).toBe(403);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('treats an expired session as a preflight rejection and does not post', async () => {
    mockSession.mockResolvedValue({ status: 401, profile: null });
    const response = await handleCustomerTransfer(post());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'SESSION_EXPIRED',
      outcome: 'failed',
    });
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('gets CSRF server-side, forwards only fixed fields with the same idempotency key, and redacts CSRF', async () => {
    mockBackend.mockResolvedValueOnce(Response.json({ csrfToken: csrf }));
    mockBackend.mockResolvedValueOnce(
      Response.json(
        { ...result, privateField: 'not forwarded' },
        { status: 201 },
      ),
    );
    const response = await handleCustomerTransfer(post());
    expect(response.status).toBe(201);
    const responseBody = await response.json();
    expect(responseBody).toEqual(result);
    expect(JSON.stringify(responseBody)).not.toContain('privateField');
    expect(response.headers.get('x-csrf-token')).toBeNull();
    expect(mockBackend).toHaveBeenNthCalledWith(1, 'auth/csrf');
    expect(mockBackend).toHaveBeenNthCalledWith(
      2,
      'transfers',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = mockBackend.mock.calls[1][1];
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe(key);
    expect(headers.get('x-csrf-token')).toBe(csrf);
    expect(JSON.parse(String(init?.body))).toEqual({
      sourceWalletId,
      destinationWalletId,
      amountMinor: '100050',
    });
  });

  it('does not post if CSRF is unavailable and safely maps known backend rejections', async () => {
    mockBackend.mockResolvedValueOnce(Response.json({}, { status: 200 }));
    const unavailable = await handleCustomerTransfer(post());
    expect(unavailable.status).toBe(502);
    expect((await unavailable.json()).outcome).toBe('failed');
    expect(mockBackend).toHaveBeenCalledTimes(1);

    mockBackend.mockReset();
    mockBackend.mockResolvedValueOnce(Response.json({ csrfToken: csrf }));
    mockBackend.mockResolvedValueOnce(
      Response.json(
        { message: 'The source wallet has insufficient funds' },
        { status: 409 },
      ),
    );
    const rejected = await handleCustomerTransfer(post());
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      outcome: 'failed',
    });
  });

  it('distinguishes idempotent retry conflicts and network failures as unknown outcomes', async () => {
    mockBackend.mockResolvedValueOnce(Response.json({ csrfToken: csrf }));
    mockBackend.mockResolvedValueOnce(
      Response.json(
        {
          message:
            'The transfer conflicted with another database transaction; retry it',
        },
        { status: 409 },
      ),
    );
    const conflict = await handleCustomerTransfer(post());
    expect(await conflict.json()).toMatchObject({
      code: 'TRANSFER_CONFLICT',
      outcome: 'unknown',
    });

    mockBackend.mockReset();
    mockBackend.mockResolvedValueOnce(Response.json({ csrfToken: csrf }));
    mockBackend.mockRejectedValueOnce(new Error('private transport detail'));
    const disconnected = await handleCustomerTransfer(post());
    expect(disconnected.status).toBe(503);
    const body = await disconnected.json();
    expect(body).toMatchObject({
      code: 'TRANSFER_OUTCOME_UNKNOWN',
      outcome: 'unknown',
    });
    expect(JSON.stringify(body)).not.toContain('private transport detail');
  });
});
