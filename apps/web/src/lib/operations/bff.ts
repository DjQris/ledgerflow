import 'server-only';

import { backendRequest, currentSession } from '@/lib/auth/backend';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

function failure(status: number): Response {
  const safeStatus = [400, 401, 403, 404, 409, 429, 500, 502, 503].includes(status) ? status : 502;
  const messages: Record<number, string> = {
    400: 'The request is invalid.',
    401: 'Your session has ended. Sign in again.',
    403: 'You are not permitted to perform this action.',
    404: 'The requested record was not found.',
    409: 'The change conflicts with current account requirements.',
    429: 'Too many requests. Wait before trying again.',
    500: 'The request could not be completed.',
    502: 'The service returned an unexpected response.',
    503: 'The operations service is temporarily unavailable.',
  };
  return json({ status: safeStatus, message: messages[safeStatus] }, safeStatus);
}

async function authorized(adminOnly: boolean): Promise<Response | null> {
  const session = await currentSession();
  if (!session.profile) return failure(session.status);
  if (adminOnly ? session.profile.role !== 'ADMIN' : !['ADMIN', 'OPERATIONS'].includes(session.profile.role)) return failure(403);
  return null;
}

async function readJson(response: Response): Promise<unknown | null> {
  if (!response.ok) return null;
  try { return await response.json() as unknown; } catch { return null; }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 1024)) throw new Error('Request body is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1024) { await reader.cancel(); throw new Error('Request body is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseMetrics(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.from !== 'string' || !DATE.test(row.from) ||
    typeof row.to !== 'string' || !DATE.test(row.to) || row.timeZone !== 'UTC' ||
    !validCount(row.completedCount) || typeof row.completedMinor !== 'string' || !/^(0|[1-9]\d*)$/.test(row.completedMinor) ||
    !validCount(row.recordedFailedTransferCount) || !validCount(row.registeredUsers) ||
    !validCount(row.pendingRetries) || !validCount(row.pendingOutboxEvents) ||
    !Array.isArray(row.daily) || !Array.isArray(row.recentActivity)
  ) return null;
  const daily = row.daily.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const day = item as Record<string, unknown>;
    if (typeof day.date !== 'string' || !DATE.test(day.date) || !validCount(day.completedCount) || !validCount(day.failedCount) || typeof day.completedMinor !== 'string' || !/^(0|[1-9]\d*)$/.test(day.completedMinor)) return null;
    return { date: day.date, completedCount: day.completedCount, failedCount: day.failedCount, completedMinor: day.completedMinor };
  });
  if (daily.some((item) => item === null)) return null;
  const recentActivity = row.recentActivity.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const event = item as Record<string, unknown>;
    if (typeof event.action !== 'string' || event.action.length > 100 || typeof event.entityType !== 'string' || event.entityType.length > 100 || typeof event.outcome !== 'string' || event.outcome.length > 20 || (event.actorType !== null && typeof event.actorType !== 'string') || typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) return null;
    return { action: event.action, entityType: event.entityType, outcome: event.outcome, actorType: event.actorType, occurredAt: event.occurredAt };
  });
  if (recentActivity.some((item) => item === null)) return null;
  return {
    from: row.from, to: row.to, timeZone: row.timeZone,
    completedCount: row.completedCount, completedMinor: row.completedMinor,
    recordedFailedTransferCount: row.recordedFailedTransferCount,
    registeredUsers: row.registeredUsers, pendingRetries: row.pendingRetries,
    pendingOutboxEvents: row.pendingOutboxEvents, daily, recentActivity,
  };
}

export async function handleOperationsMetrics(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !['from', 'to'].includes(key)) || ['from', 'to'].some((key) => url.searchParams.getAll(key).length > 1)) return failure(400);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ((from && !DATE.test(from)) || (to && !DATE.test(to)) || (from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))) || (from && to && Date.parse(from) > Date.parse(to))) return failure(400);
  try {
    const denied = await authorized(false);
    if (denied) return denied;
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const [metricsResponse, readyResponse] = await Promise.all([
      backendRequest(`operations/metrics${query.size ? `?${query}` : ''}`),
      backendRequest('health/ready').catch(() => null),
    ]);
    if (!metricsResponse.ok) return failure(metricsResponse.status);
    const metrics = parseMetrics(await readJson(metricsResponse));
    if (!metrics) return failure(502);
    const readiness = readyResponse?.ok ? await readJson(readyResponse) : null;
    const apiReadiness = readiness && typeof readiness === 'object' && 'status' in readiness && (readiness as { status?: unknown }).status === 'ok' ? 'ready' : 'unavailable';
    return json({ ...metrics, apiReadiness });
  } catch { return failure(503); }
}

function parseUser(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !uuidV4.test(row.id) || typeof row.email !== 'string' || row.email.length > 254 || !['CUSTOMER', 'OPERATIONS', 'ADMIN'].includes(String(row.role)) || !['ACTIVE', 'SUSPENDED'].includes(String(row.status)) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) return null;
  return { id: row.id, email: row.email, role: row.role, status: row.status, createdAt: row.createdAt };
}

export async function handleAdminUsers(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const allowed = ['page', 'pageSize', 'search', 'role', 'status'];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key)) || allowed.some((key) => url.searchParams.getAll(key).length > 1)) return failure(400);
  const page = url.searchParams.get('page') ?? '1';
  const pageSize = url.searchParams.get('pageSize') ?? '20';
  const search = url.searchParams.get('search') ?? '';
  const role = url.searchParams.get('role');
  const status = url.searchParams.get('status');
  if (!/^[1-9]\d{0,4}$/.test(page) || Number(page) > 10_000 || !/^[1-9]\d*$/.test(pageSize) || Number(pageSize) > 100 || search.length > 100 || (role && !['CUSTOMER', 'OPERATIONS', 'ADMIN'].includes(role)) || (status && !['ACTIVE', 'SUSPENDED'].includes(status))) return failure(400);
  try {
    const denied = await authorized(true);
    if (denied) return denied;
    const query = new URLSearchParams({ page, pageSize });
    if (search) query.set('search', search);
    if (role) query.set('role', role);
    if (status) query.set('status', status);
    const response = await backendRequest(`admin/users/search?${query}`);
    if (!response.ok) return failure(response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(502);
    const result = body as Record<string, unknown>;
    if (!Array.isArray(result.data) || !result.pagination || typeof result.pagination !== 'object') return failure(502);
    const data = result.data.map(parseUser);
    const pagination = result.pagination as Record<string, unknown>;
    if (data.some((user) => user === null) || !['page', 'pageSize', 'total', 'totalPages'].every((key) => validCount(pagination[key]))) return failure(502);
    return json({ data, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, totalPages: pagination.totalPages } });
  } catch { return failure(503); }
}

export async function handleAdminUser(id: string): Promise<Response> {
  if (!uuidV4.test(id)) return failure(400);
  try {
    const denied = await authorized(true);
    if (denied) return denied;
    const response = await backendRequest(`admin/users/${id}`);
    if (!response.ok) return failure(response.status);
    const user = parseUser(await readJson(response));
    return user ? json(user) : failure(502);
  } catch { return failure(503); }
}

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function serverCsrfToken(): Promise<string | null> {
  const response = await backendRequest('auth/csrf');
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'csrfToken' in body && typeof body.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/.test(body.csrfToken)) return body.csrfToken;
  } catch { /* Keep malformed token responses server-side. */ }
  return null;
}

export async function handleAdminUserMutation(request: Request, id: string, action: 'role' | 'status'): Promise<Response> {
  if (!sameOrigin(request)) return failure(403);
  if (!uuidV4.test(id)) return failure(400);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure(400);
  let body: unknown;
  try { body = await readBoundedJson(request); } catch { return failure(400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(400);
  const value = (body as Record<string, unknown>)[action];
  if (Object.keys(body).length !== 1 || (action === 'role' ? !['CUSTOMER', 'OPERATIONS', 'ADMIN'].includes(String(value)) : !['ACTIVE', 'SUSPENDED'].includes(String(value)))) return failure(400);
  try {
    const denied = await authorized(true);
    if (denied) return denied;
    const token = await serverCsrfToken();
    if (!token) return failure(503);
    const response = await backendRequest(`admin/users/${id}/${action}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ [action]: value }),
    });
    if (!response.ok) return failure(response.status);
    const user = parseUser(await readJson(response));
    return user ? json(user) : failure(502);
  } catch { return failure(503); }
}
