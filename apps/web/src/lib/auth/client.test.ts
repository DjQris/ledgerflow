import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, getCurrentUser } from './client';

const profile = { id: 'user-1', email: 'a@example.com', role: 'CUSTOMER', status: 'ACTIVE' };

describe('client session refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries /me once after a CSRF-protected BFF refresh', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ message: 'expired' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ message: 'expired' }, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(profile));
    vi.stubGlobal('fetch', fetcher);
    expect(await getCurrentUser()).toEqual(profile);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/me', '/api/auth/me', '/api/auth/refresh', '/api/auth/me',
    ]);
  });

  it('stops on a failed refresh instead of looping', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ message: 'Session ended.' }, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getCurrentUser()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not refresh on a permission error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ message: 'Forbidden' }, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps network outages to a safe 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private connection detail')));
    await expect(getCurrentUser()).rejects.toMatchObject({ status: 503 });
  });
});
