import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/backend', () => ({ backendRequest: vi.fn(), currentSession: vi.fn() }));

import { backendRequest, currentSession } from '@/lib/auth/backend';
import { handleAdminUserMutation, handleAdminUsers, handleOperationsMetrics } from './bff';

const mockBackend = vi.mocked(backendRequest);
const mockSession = vi.mocked(currentSession);
const userId = 'a5e0df47-36f4-4314-8a04-71464ba8996c';
const admin = { id: userId, email: 'admin@example.test', role: 'ADMIN' as const, status: 'ACTIVE' as const };
const csrf = `${'A'.repeat(43)}.${'a'.repeat(64)}`;

describe('operations BFF role and data boundaries', () => {
  beforeEach(() => {
    mockBackend.mockReset();
    mockSession.mockReset();
  });

  it('allows operations metrics to staff and strips audit metadata', async () => {
    mockSession.mockResolvedValue({ status: 200, profile: { ...admin, role: 'OPERATIONS' } });
    mockBackend
      .mockResolvedValueOnce(Response.json({
        from: '2026-10-01', to: '2026-10-01', timeZone: 'UTC', completedCount: 2,
        completedMinor: '1000', recordedFailedTransferCount: 0, registeredUsers: 10,
        pendingRetries: 1, pendingOutboxEvents: 2,
        daily: [{ date: '2026-10-01', completedCount: 2, failedCount: 0, completedMinor: '1000' }],
        recentActivity: [{ action: 'wallet_created', entityType: 'wallet', outcome: 'SUCCEEDED', actorType: 'user', occurredAt: '2026-10-01T10:00:00Z', metadata: { secret: 'not forwarded' } }],
      }))
      .mockResolvedValueOnce(Response.json({ status: 'ok' }));
    const response = await handleOperationsMetrics(new Request('http://local/api/operations/metrics?from=2026-10-01&to=2026-10-01'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.apiReadiness).toBe('ready');
    expect(body.recentActivity[0].metadata).toBeUndefined();
    expect(mockBackend).toHaveBeenNthCalledWith(1, 'operations/metrics?from=2026-10-01&to=2026-10-01');
    expect(mockBackend).toHaveBeenNthCalledWith(2, 'health/ready');
  });

  it('keeps user listing administrator-only before forwarding', async () => {
    mockSession.mockResolvedValue({ status: 200, profile: { ...admin, role: 'OPERATIONS' } });
    const response = await handleAdminUsers(new Request('http://local/api/operations/users'));
    expect(response.status).toBe(403);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('rejects unbounded pagination and duplicate filter parameters', async () => {
    expect((await handleAdminUsers(new Request('http://local/api/operations/users?page=10001'))).status).toBe(400);
    expect((await handleAdminUsers(new Request('http://local/api/operations/users?page=1&page=2'))).status).toBe(400);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('forwards status/role changes only after same-origin, admin, and server CSRF checks', async () => {
    const foreign = new Request(`http://local/api/operations/users/${userId}/role`, {
      method: 'PATCH', headers: { origin: 'https://attacker.test', 'content-type': 'application/json' }, body: JSON.stringify({ role: 'OPERATIONS' }),
    });
    expect((await handleAdminUserMutation(foreign, userId, 'role')).status).toBe(403);
    expect(mockSession).not.toHaveBeenCalled();

    mockSession.mockResolvedValue({ status: 200, profile: admin });
    mockBackend
      .mockResolvedValueOnce(Response.json({ csrfToken: csrf }))
      .mockResolvedValueOnce(Response.json({ id: userId, email: 'admin@example.test', role: 'OPERATIONS', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z' }));
    const sameOrigin = new Request(`http://local/api/operations/users/${userId}/role`, {
      method: 'PATCH', headers: { origin: 'http://local', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ role: 'OPERATIONS' }),
    });
    const response = await handleAdminUserMutation(sameOrigin, userId, 'role');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: 'OPERATIONS', status: 'ACTIVE' });
    expect(mockBackend).toHaveBeenNthCalledWith(1, 'auth/csrf');
    expect(mockBackend).toHaveBeenNthCalledWith(2, `admin/users/${userId}/role`, expect.objectContaining({
      method: 'PATCH', headers: expect.objectContaining({ 'x-csrf-token': csrf }),
    }));
    expect(mockBackend).toHaveBeenCalledTimes(2);
  });
});
