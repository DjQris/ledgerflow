'use client';

import { ApiError, refreshSession } from '@/lib/auth/client';

export type OperationsJob = {
  id: string;
  eventId: string;
  jobId: string;
  source: 'dispatcher' | 'worker';
  eventType: string | null;
  transferId: string | null;
  processingStatus: string | null;
  transferStatus: string | null;
  eventCreatedAt: string | null;
  failureCategory: 'temporary' | 'permanent';
  failureReason: string;
  attempts: number;
  firstFailureAt: string;
  lastFailureAt: string;
  updatedAt: string;
  status: 'retrying' | 'dead_letter' | 'retry_pending' | 'resolved';
  retryActorId: string | null;
};

export type OperationsJobsFilter = {
  limit: number;
  status?: OperationsJob['status'];
  source?: OperationsJob['source'];
  eventType?: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  actorId: string | null;
  actorType: string | null;
  entityId: string;
  entityType: string;
  outcome: 'SUCCEEDED' | 'REJECTED';
  occurredAt: string;
  context: Record<string, string | number> | null;
};

export type AuditPage = {
  data: AuditEvent[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type AuditFilter = {
  page: number;
  pageSize: number;
  search?: string;
  action?: string;
  entityType?: string;
  outcome?: 'SUCCEEDED' | 'REJECTED';
  from?: string;
  to?: string;
};

export type ReconciliationReport = {
  reportId: string;
  checkedAt: string;
  accountCount: string;
  journalCount: string;
  walletCount: string;
  ok: boolean;
  issues: { code: string; resourceType: 'journal' | 'wallet'; resourceId: string; detail: Record<string, string> }[];
};

async function request<T>(path: string, init: RequestInit = {}, mayRefresh = true): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' }); }
  catch { throw new ApiError(503, 'Operations data is temporarily unavailable.'); }
  if (response.status === 401 && mayRefresh) {
    try { await refreshSession(); return request<T>(path, init, false); }
    catch { throw new ApiError(401, 'Your session has ended. Sign in again.'); }
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'The request could not be completed.';
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export function getOperationsJobs(filter: OperationsJobsFilter): Promise<OperationsJob[]> {
  const query = new URLSearchParams({ limit: String(filter.limit) });
  if (filter.status) query.set('status', filter.status);
  if (filter.source) query.set('source', filter.source);
  if (filter.eventType) query.set('eventType', filter.eventType);
  return request(`/api/operations/jobs?${query}`);
}

export function getOperationsJob(id: string): Promise<OperationsJob> {
  return request(`/api/operations/jobs/${encodeURIComponent(id)}`);
}

export function retryOperationsJob(id: string): Promise<{ status: 'queued' | 'queued_for_dispatch' | 'already_processed'; jobId: string }> {
  return request(`/api/operations/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }, false);
}

export function getOperationsAudit(filter: AuditFilter): Promise<AuditPage> {
  const query = new URLSearchParams({ page: String(filter.page), pageSize: String(filter.pageSize) });
  for (const key of ['search', 'action', 'entityType', 'outcome', 'from', 'to'] as const) {
    const value = filter[key];
    if (value) query.set(key, value);
  }
  return request(`/api/operations/audit?${query}`);
}

export function getLedgerReconciliation(): Promise<ReconciliationReport> {
  return request('/api/operations/reconciliation');
}
