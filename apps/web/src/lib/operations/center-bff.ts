import 'server-only';

import { backendRequest, currentSession } from '@/lib/auth/backend';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_JOB_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|invalid-[0-9a-f]{32})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JOB_STATUSES = ['retrying', 'dead_letter', 'retry_pending', 'resolved'];
const JOB_SOURCES = ['dispatcher', 'worker'];
const JOB_REASONS = ['INVALID_JOB', 'INVALID_EVENT_PAYLOAD', 'UNSUPPORTED_EVENT_VERSION', 'EVENT_DATA_UNAVAILABLE', 'EVENT_MISMATCH', 'DATABASE_UNAVAILABLE', 'OPERATION_TIMEOUT', 'PROCESSING_FAILED', 'REDIS_UNAVAILABLE'];
const AUDIT_OUTCOMES = ['SUCCEEDED', 'REJECTED'];

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

function failure(status: number): Response {
  const safe = [400, 401, 403, 404, 409, 429, 500, 502, 503].includes(status) ? status : 502;
  const message: Record<number, string> = {
    400: 'The request is invalid.', 401: 'Your session has ended. Sign in again.',
    403: 'You are not permitted to perform this action.', 404: 'The requested record was not found.',
    409: 'The operation is no longer eligible. Refresh the record and review its status.',
    429: 'Too many requests. Wait before trying again.', 500: 'The request could not be completed.',
    502: 'The service returned an unexpected response.', 503: 'The operations service is temporarily unavailable.',
  };
  return json({ status: safe, message: message[safe] }, safe);
}

async function authorized(): Promise<Response | null> {
  const session = await currentSession();
  if (!session.profile) return failure(session.status);
  if (!['OPERATIONS', 'ADMIN'].includes(session.profile.role)) return failure(403);
  return null;
}

async function safeBody(response: Response): Promise<unknown | null> {
  if (!response.ok) return null;
  try { return await response.json() as unknown; } catch { return null; }
}

function dateIsValid(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function parseJob(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const firstFailureAt = timestamp(row.firstFailureAt);
  const lastFailureAt = timestamp(row.lastFailureAt);
  const updatedAt = timestamp(row.updatedAt);
  const eventCreatedAt = row.eventCreatedAt === null ? null : timestamp(row.eventCreatedAt);
  if (
    typeof row.id !== 'string' || !UUID.test(row.id) ||
    typeof row.eventId !== 'string' || !SAFE_JOB_ID.test(row.eventId) ||
    typeof row.jobId !== 'string' || !SAFE_JOB_ID.test(row.jobId) ||
    !JOB_SOURCES.includes(String(row.source)) ||
    !JOB_STATUSES.includes(String(row.status)) ||
    !['temporary', 'permanent'].includes(String(row.failureCategory)) ||
    !JOB_REASONS.includes(String(row.failureReason)) ||
    !Number.isSafeInteger(row.attempts) || (row.attempts as number) < 1 ||
    !firstFailureAt || !lastFailureAt || !updatedAt ||
    (row.eventCreatedAt !== null && !eventCreatedAt) ||
    (row.eventType !== null && row.eventType !== 'transfer.completed') ||
    (row.transferId !== null && (typeof row.transferId !== 'string' || !UUID.test(row.transferId))) ||
    (row.processingStatus !== null && !['pending', 'claimed', 'published', 'dead_letter'].includes(String(row.processingStatus))) ||
    (row.transferStatus !== null && !['pending', 'completed', 'failed', 'reversed'].includes(String(row.transferStatus))) ||
    (row.retryActorId !== null && (typeof row.retryActorId !== 'string' || !UUID.test(row.retryActorId)))
  ) return null;
  return {
    id: row.id, eventId: row.eventId, jobId: row.jobId, source: row.source,
    eventType: row.eventType, transferId: row.transferId, processingStatus: row.processingStatus,
    transferStatus: row.transferStatus, eventCreatedAt, failureCategory: row.failureCategory,
    failureReason: row.failureReason, attempts: row.attempts, firstFailureAt,
    lastFailureAt, updatedAt, status: row.status,
  };
}

export async function handleOperationsJobs(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const allowed = ['limit', 'status', 'source', 'eventType'];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key)) || allowed.some((key) => url.searchParams.getAll(key).length > 1)) return failure(400);
  const limit = url.searchParams.get('limit') ?? '50';
  const status = url.searchParams.get('status');
  const source = url.searchParams.get('source');
  const eventType = url.searchParams.get('eventType');
  if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100 || (status && !JOB_STATUSES.includes(status)) || (source && !JOB_SOURCES.includes(source)) || (eventType && eventType !== 'transfer.completed')) return failure(400);
  try {
    const denied = await authorized();
    if (denied) return denied;
    const query = new URLSearchParams({ limit });
    if (status) query.set('status', status);
    if (source) query.set('source', source);
    if (eventType) query.set('eventType', eventType);
    const response = await backendRequest(`ops/jobs/failed?${query}`);
    if (!response.ok) return failure(response.status);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return failure(502);
    const jobs = body.map(parseJob);
    return jobs.some((job) => job === null) ? failure(502) : json(jobs);
  } catch { return failure(503); }
}

export async function handleOperationsJob(id: string): Promise<Response> {
  if (!UUID.test(id)) return failure(400);
  try {
    const denied = await authorized();
    if (denied) return denied;
    const response = await backendRequest(`ops/jobs/${id}`);
    if (!response.ok) return failure(response.status);
    const job = parseJob(await safeBody(response));
    return job ? json(job) : failure(502);
  } catch { return failure(503); }
}

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function csrfToken(): Promise<string | null> {
  const response = await backendRequest('auth/csrf');
  if (!response.ok) return null;
  const body: unknown = await safeBody(response);
  if (body && typeof body === 'object' && 'csrfToken' in body && typeof body.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/.test(body.csrfToken)) return body.csrfToken;
  return null;
}

export async function handleOperationsRetry(request: Request, id: string): Promise<Response> {
  if (!sameOrigin(request)) return failure(403);
  if (!UUID.test(id)) return failure(400);
  try {
    const denied = await authorized();
    if (denied) return denied;
    const token = await csrfToken();
    if (!token) return failure(503);
    const response = await backendRequest(`ops/jobs/${id}/retry`, {
      method: 'POST', headers: { 'x-csrf-token': token },
    });
    if (!response.ok) {
      if (response.status === 503) return json({ status: 503, message: 'The queue service is unavailable. A retry intent may remain pending; refresh the job status before requesting again.' }, 503);
      return failure(response.status);
    }
    const body: unknown = await safeBody(response);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(502);
    const result = body as Record<string, unknown>;
    if (!['queued', 'queued_for_dispatch', 'already_processed'].includes(String(result.status)) || typeof result.jobId !== 'string' || !SAFE_JOB_ID.test(result.jobId)) return failure(502);
    return json({ status: result.status, jobId: result.jobId });
  } catch { return failure(503); }
}

const AUDIT_METADATA_KEYS: Record<string, readonly string[]> = {
  transfer_completed: ['amountMinor', 'journalId'],
  transfer_rejected: ['amountMinor', 'httpStatus', 'reason'],
  idempotency_conflict: ['amountMinor', 'httpStatus', 'reason'],
  development_opening_funding_posted: ['amountMinor', 'journalId'],
  account_role_changed: ['from', 'to'],
  background_retry_denied: ['reason'],
  background_retry_already_processed: ['eventId'],
  background_retry_resumed: ['eventId', 'source'],
  background_retry_requested: ['eventId', 'source'],
  login_rejected: ['reason'], registration_rejected: ['reason'],
  refresh_rejected: ['reason'], refresh_token_reuse_detected: ['reason'],
};

function parseAuditEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const occurredAt = timestamp(row.occurredAt);
  if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.entityId !== 'string' || !UUID.test(row.entityId) ||
      typeof row.action !== 'string' || row.action.length > 100 || typeof row.entityType !== 'string' || row.entityType.length > 100 ||
      (row.actorId !== null && (typeof row.actorId !== 'string' || row.actorId.length > 255)) ||
      (row.actorType !== null && (typeof row.actorType !== 'string' || row.actorType.length > 100)) ||
      !AUDIT_OUTCOMES.includes(String(row.outcome)) || !occurredAt) return null;
  const context: Record<string, string | number> = {};
  if (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)) {
    const metadata = row.metadata as Record<string, unknown>;
    for (const key of AUDIT_METADATA_KEYS[row.action] ?? []) {
      const item = metadata[key];
      if (key === 'amountMinor' && typeof item === 'string' && /^(0|[1-9]\d{0,18})$/.test(item)) context[key] = item;
      else if (key === 'httpStatus' && typeof item === 'number' && Number.isInteger(item) && item >= 400 && item <= 599) context[key] = item;
      else if (['journalId', 'eventId'].includes(key) && typeof item === 'string' && UUID.test(item)) context[key] = item;
      else if (key === 'source' && ['worker', 'dispatcher'].includes(String(item))) context[key] = item as string;
      else if (['from', 'to'].includes(key) && ['CUSTOMER', 'OPERATIONS', 'ADMIN'].includes(String(item))) context[key] = item as string;
      else if (key === 'reason' && typeof item === 'string' && /^[A-Z0-9_]{1,64}$/.test(item)) context[key] = item;
    }
  }
  return {
    id: row.id, action: row.action, actorId: typeof row.actorId === 'string' && UUID.test(row.actorId) ? row.actorId : null, actorType: row.actorType,
    entityId: row.entityId, entityType: row.entityType, outcome: row.outcome,
    occurredAt, context: Object.keys(context).length ? context : null,
  };
}

export async function handleOperationsAudit(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const allowed = ['page', 'pageSize', 'search', 'action', 'entityType', 'outcome', 'from', 'to'];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key)) || allowed.some((key) => url.searchParams.getAll(key).length > 1)) return failure(400);
  const page = url.searchParams.get('page') ?? '1';
  const pageSize = url.searchParams.get('pageSize') ?? '20';
  const search = url.searchParams.get('search') ?? '';
  const action = url.searchParams.get('action');
  const entityType = url.searchParams.get('entityType');
  const outcome = url.searchParams.get('outcome');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!/^[1-9]\d{0,4}$/.test(page) || Number(page) > 10_000 || !/^[1-9]\d*$/.test(pageSize) || Number(pageSize) > 100 ||
      search.length > 100 || (action && action.length > 100) || (entityType && entityType.length > 100) ||
      (outcome && !AUDIT_OUTCOMES.includes(outcome)) || (from && !dateIsValid(from)) || (to && !dateIsValid(to)) || (from && to && from > to)) return failure(400);
  try {
    const denied = await authorized();
    if (denied) return denied;
    const query = new URLSearchParams({ page, pageSize });
    if (search) query.set('search', search);
    if (action) query.set('action', action);
    if (entityType) query.set('entityType', entityType);
    if (outcome) query.set('outcome', outcome);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const response = await backendRequest(`audit-events/search?${query}`);
    if (!response.ok) return failure(response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(502);
    const result = body as Record<string, unknown>;
    if (!Array.isArray(result.data) || !result.pagination || typeof result.pagination !== 'object') return failure(502);
    const data = result.data.map(parseAuditEvent);
    const pagination = result.pagination as Record<string, unknown>;
    if (data.some((row) => row === null) || !['page', 'pageSize', 'total', 'totalPages'].every((key) => Number.isSafeInteger(pagination[key]) && (pagination[key] as number) >= 0)) return failure(502);
    return json({ data, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, totalPages: pagination.totalPages } });
  } catch { return failure(503); }
}

export async function handleOperationsReconciliation(): Promise<Response> {
  try {
    const denied = await authorized();
    if (denied) return denied;
    const response = await backendRequest('ops/reconciliation');
    if (!response.ok) return failure(response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(502);
    const report = body as Record<string, unknown>;
    if (!UUID.test(String(report.reportId)) || !timestamp(report.checkedAt) || !['accountCount', 'journalCount', 'walletCount'].every((key) => typeof report[key] === 'string' && /^(0|[1-9]\d*)$/.test(report[key] as string)) || typeof report.ok !== 'boolean' || !Array.isArray(report.issues)) return failure(502);
    const issues = report.issues.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const issue = value as Record<string, unknown>;
      if (!['UNBALANCED_JOURNAL', 'JOURNAL_ENTRY_CURRENCY_MISMATCH', 'WALLET_ACCOUNT_MISSING', 'WALLET_BALANCE_MISMATCH'].includes(String(issue.code)) || !['journal', 'wallet'].includes(String(issue.resourceType)) || typeof issue.resourceId !== 'string' || !UUID.test(issue.resourceId) || !issue.detail || typeof issue.detail !== 'object' || Array.isArray(issue.detail)) return null;
      const detail: Record<string, string> = {};
      for (const [key, value] of Object.entries(issue.detail as Record<string, unknown>)) {
        if (!['entryCount', 'totalMinor', 'mismatchedCurrencyCount', 'ledgerTotalMinor', 'projectedBalanceMinor'].includes(key)) continue;
        if (typeof value !== 'string' || value.length > 40) return null;
        detail[key] = value;
      }
      return { code: issue.code, resourceType: issue.resourceType, resourceId: issue.resourceId, detail };
    });
    if (issues.some((issue) => issue === null) || report.ok !== (issues.length === 0)) return failure(502);
    return json({ reportId: report.reportId, checkedAt: timestamp(report.checkedAt), accountCount: report.accountCount, journalCount: report.journalCount, walletCount: report.walletCount, ok: report.ok, issues });
  } catch { return failure(503); }
}
