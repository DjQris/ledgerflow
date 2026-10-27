import 'server-only';

import { backendRequest, parseProfile } from './backend';

type Operation = 'register' | 'login' | 'me' | 'refresh' | 'logout';

const messages: Record<number, string> = {
  400: 'Please check the details and try again.',
  413: 'Request is too large.',
  401: 'Your session has ended. Please sign in again.',
  403: 'This request is not permitted.',
  409: 'An account with this email already exists.',
  429: 'Too many attempts. Please wait and try again.',
  500: 'Something went wrong. Please try again.',
  503: 'Service is temporarily unavailable. Please try again.',
};

function json(data: unknown, status: number, headers?: Headers): Response {
  return Response.json(data, {
    status,
    headers: headers ?? { 'cache-control': 'no-store' },
  });
}

function failure(status: number, operation: Operation): Response {
  const safeStatus = [400, 401, 403, 409, 413, 429, 500, 503].includes(status) ? status : 502;
  return json({
    status: safeStatus,
    message: operation === 'login' && safeStatus === 401
      ? 'Invalid email or password.'
      : messages[safeStatus] ?? 'The service returned an unexpected response.',
  }, safeStatus);
}

class PayloadTooLargeError extends Error {}

async function readJsonBody(request: Request, limit: number): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('Invalid content length');
    if (Number(declaredLength) > limit) throw new PayloadTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing request body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return origin === expected && fetchSite !== 'cross-site';
}

function copySessionCookies(source: Response, target: Headers): boolean {
  const values = source.headers.getSetCookie();
  for (const value of values) {
    const name = value.split('=', 1)[0];
    if (
      !['ledgerflow_access', 'ledgerflow_refresh', '__Host-ledgerflow_access', '__Host-ledgerflow_refresh'].includes(name) ||
      !/;\s*HttpOnly(?:;|$)/i.test(value) ||
      !/;\s*Path=\/(?:;|$)/i.test(value) ||
      !/;\s*SameSite=Lax(?:;|$)/i.test(value) ||
      /;\s*Domain=/i.test(value) ||
      (name.startsWith('__Host-') && !/;\s*Secure(?:;|$)/i.test(value))
    ) return false;
  }
  for (const value of values) target.append('set-cookie', value);
  return true;
}

async function requestCsrf(path: 'auth/csrf' | 'auth/refresh-csrf'): Promise<{ status: number; token: string | null }> {
  const response = await backendRequest(path);
  if (!response.ok) return { status: response.status, token: null };
  const body: unknown = await response.json();
  const token = body && typeof body === 'object' && 'csrfToken' in body
    ? (body as { csrfToken: unknown }).csrfToken : null;
  return typeof token === 'string' && token.length > 0
    ? { status: 200, token }
    : { status: 502, token: null };
}

async function csrfForLogout(): Promise<{ status: number; token: string | null }> {
  const access = await requestCsrf('auth/csrf');
  return access.status === 401 ? requestCsrf('auth/refresh-csrf') : access;
}

function clearLocalCookies(response: Response): Response {
  for (const name of ['ledgerflow_access', 'ledgerflow_refresh', '__Host-ledgerflow_access', '__Host-ledgerflow_refresh']) {
    response.headers.append('set-cookie', `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${name.startsWith('__Host-') ? '; Secure' : ''}`);
  }
  return response;
}

export async function handleAuth(request: Request, operation: Operation): Promise<Response> {
  const mutation = operation !== 'me';
  if (mutation && !sameOrigin(request)) return failure(403, operation);

  let body: string | undefined;
  if (operation === 'register' || operation === 'login') {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      return failure(400, operation);
    }
    try {
      const input = await readJsonBody(request, 16_384);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return failure(400, operation);
      const value = input as Record<string, unknown>;
      if (Object.keys(value).some((key) => !['email', 'password'].includes(key)) ||
        typeof value.email !== 'string' || typeof value.password !== 'string') return failure(400, operation);
      body = JSON.stringify({ email: value.email, password: value.password });
      if (new TextEncoder().encode(body).byteLength > 16_384) return failure(413, operation);
    } catch (error) {
      return failure(error instanceof PayloadTooLargeError ? 413 : 400, operation);
    }
  }

  try {
    let csrf: string | null = null;
    if (operation === 'refresh') {
      const result = await requestCsrf('auth/refresh-csrf');
      if (!result.token) {
        const response = failure(result.status, operation);
        return result.status === 401 ? clearLocalCookies(response) : response;
      }
      csrf = result.token;
    }
    if (operation === 'logout') {
      const result = await csrfForLogout();
      if (result.status !== 401 && !result.token) return failure(result.status, operation);
      csrf = result.token;
    }

    const headers = new Headers();
    if (body) headers.set('content-type', 'application/json');
    if (csrf) headers.set('x-csrf-token', csrf);
    const response = await backendRequest(`auth/${operation}`, {
      method: mutation ? 'POST' : 'GET',
      headers,
      body,
    });
    const outgoing = new Headers({ 'cache-control': 'no-store' });
    if (!copySessionCookies(response, outgoing)) return failure(502, operation);
    if (!response.ok) {
      const result = failure(response.status, operation);
      for (const cookie of outgoing.getSetCookie()) result.headers.append('set-cookie', cookie);
      return result;
    }
    if (operation === 'logout' || operation === 'refresh') return new Response(null, { status: 204, headers: outgoing });
    const profile = parseProfile(await response.json());
    if (!profile || profile.status !== 'ACTIVE') return failure(502, operation);
    return json(profile, response.status, outgoing);
  } catch {
    return failure(503, operation);
  }
}
