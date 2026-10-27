import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./backend', () => ({
  backendRequest: vi.fn(),
  parseProfile: (value: unknown) => value,
}));

import { backendRequest } from './backend';
import { handleAuth } from './bff';

const mockBackend = vi.mocked(backendRequest);
const profile = { id: 'user-1', email: 'a@example.com', role: 'CUSTOMER', status: 'ACTIVE' };
const origin = 'http://localhost:3001';
const cookie = 'ledgerflow_access=token; Max-Age=900; Path=/; HttpOnly; SameSite=Lax';

function write(path: string, body?: object, requestOrigin = origin): Request {
  return new Request(`${origin}/api/auth/${path}`, {
    method: 'POST',
    headers: { origin: requestOrigin, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('auth-only BFF', () => {
  beforeEach(() => mockBackend.mockReset());

  it('rejects foreign and missing origins before contacting the backend', async () => {
    expect((await handleAuth(write('login', { email: 'a@example.com', password: 'secret' }, 'https://evil.example'), 'login')).status).toBe(403);
    expect((await handleAuth(new Request(`${origin}/api/auth/logout`, { method: 'POST' }), 'logout')).status).toBe(403);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('forwards only the declared login fields and host-only HTTP-only cookies', async () => {
    const headers = new Headers({ 'x-csrf-token': 'internal-csrf' });
    headers.append('set-cookie', cookie);
    mockBackend.mockResolvedValueOnce(Response.json(profile, { headers }));
    const response = await handleAuth(write('login', { email: 'a@example.com', password: 'secret' }), 'login');
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([cookie]);
    expect(response.headers.get('x-csrf-token')).toBeNull();
    expect(await response.json()).toEqual(profile);
    expect(mockBackend).toHaveBeenCalledWith('auth/login', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'a@example.com', password: 'secret' }),
    }));
  });

  it('rejects extra payload fields and backend domain cookies', async () => {
    expect((await handleAuth(write('register', { email: 'a@example.com', password: 'secret', role: 'ADMIN' }), 'register')).status).toBe(400);
    expect(mockBackend).not.toHaveBeenCalled();
    const headers = new Headers();
    headers.append('set-cookie', `${cookie}; Domain=example.com`);
    mockBackend.mockResolvedValueOnce(Response.json(profile, { headers }));
    expect((await handleAuth(write('login', { email: 'a@example.com', password: 'secret' }), 'login')).status).toBe(502);
  });

  it('enforces the body limit while streaming when content-length is absent', async () => {
    const request = new Request(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({
            email: 'a@example.com', password: 'x'.repeat(17_000),
          })));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await handleAuth(request, 'register')).status).toBe(413);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('uses byte length for JSON bodies with multibyte characters', async () => {
    const request = new Request(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'é'.repeat(9_000) }),
    });
    expect((await handleAuth(request, 'register')).status).toBe(413);
    expect(mockBackend).not.toHaveBeenCalled();
  });

  it('obtains a refresh-bound CSRF token before rotating and does not expose it', async () => {
    mockBackend.mockResolvedValueOnce(Response.json({ csrfToken: 'csrf-token' }));
    const headers = new Headers();
    headers.append('set-cookie', cookie);
    mockBackend.mockResolvedValueOnce(new Response(null, { status: 204, headers }));
    const response = await handleAuth(write('refresh'), 'refresh');
    expect(response.status).toBe(204);
    expect(response.headers.get('x-csrf-token')).toBeNull();
    expect(mockBackend).toHaveBeenNthCalledWith(1, 'auth/refresh-csrf');
    expect(mockBackend).toHaveBeenNthCalledWith(2, 'auth/refresh', expect.objectContaining({
      headers: expect.any(Headers),
    }));
    const init = mockBackend.mock.calls[1][1];
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token');
  });

  it('never rotates after missing refresh CSRF and normalizes backend errors', async () => {
    mockBackend.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    expect((await handleAuth(write('refresh'), 'refresh')).status).toBe(401);
    expect(mockBackend).toHaveBeenCalledTimes(1);
    mockBackend.mockResolvedValueOnce(Response.json({ message: 'internal secret detail' }, { status: 500 }));
    const response = await handleAuth(write('login', { email: 'a@example.com', password: 'secret' }), 'login');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('internal secret detail');
  });

  it.each([401, 403, 409, 429, 500, 503])('preserves status %i with a safe message', async (status) => {
    mockBackend.mockResolvedValueOnce(Response.json({ message: 'private backend detail' }, { status }));
    const result = await handleAuth(write('register', { email: 'a@example.com', password: 'secret' }), 'register');
    expect(result.status).toBe(status);
    expect(JSON.stringify(await result.json())).not.toContain('private backend detail');
  });

  it('surfaces backend outages without revealing transport details', async () => {
    mockBackend.mockRejectedValueOnce(new Error('private host and secret'));
    const result = await handleAuth(write('login', { email: 'a@example.com', password: 'secret' }), 'login');
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain('private host and secret');
  });
});
