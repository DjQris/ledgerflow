import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/backend', () => ({ backendRequest: vi.fn(), currentSession: vi.fn() }));

import { backendRequest, currentSession } from '@/lib/auth/backend';
import { handleOperationsAudit, handleOperationsJob, handleOperationsJobs, handleOperationsReconciliation, handleOperationsRetry } from './center-bff';

const backend = vi.mocked(backendRequest);
const session = vi.mocked(currentSession);
const recordId = 'a5e0df47-36f4-4314-8a04-71464ba8996c';
const eventId = 'b5e0df47-36f4-4314-8a04-71464ba8996c';
const csrf = `${'A'.repeat(43)}.${'a'.repeat(64)}`;
const staff = { id: recordId, email: 'operator@example.test', role: 'OPERATIONS' as const, status: 'ACTIVE' as const };
const job = {
  id: recordId, eventId, jobId: eventId, source: 'worker', eventType: 'transfer.completed', transferId: eventId,
  processingStatus: 'published', transferStatus: 'completed', eventCreatedAt: '2026-10-27T09:00:00.000Z',
  failureCategory: 'temporary', failureReason: 'PROCESSING_FAILED', attempts: 3,
  firstFailureAt: '2026-10-27T09:01:00.000Z', lastFailureAt: '2026-10-27T09:02:00.000Z',
  updatedAt: '2026-10-27T09:02:00.000Z', status: 'dead_letter', retryActorId: null,
  rawPayload: { secret: 'never pass' },
};

describe('operations center BFF', () => {
  beforeEach(() => {
    backend.mockReset();
    session.mockReset();
    session.mockResolvedValue({ status: 200, profile: staff });
  });

  it('returns only safe failed-job fields and forwards validated job filters', async () => {
    backend.mockResolvedValueOnce(Response.json([job]));
    const response = await handleOperationsJobs(new Request('http://local/api/operations/jobs?limit=10&status=dead_letter&source=worker&eventType=transfer.completed'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body[0].rawPayload).toBeUndefined();
    expect(body[0].failureReason).toBe('PROCESSING_FAILED');
    expect(backend).toHaveBeenCalledWith('ops/jobs/failed?limit=10&status=dead_letter&source=worker&eventType=transfer.completed');
  });

  it('blocks customer access and malformed job queries before backend forwarding', async () => {
    session.mockResolvedValue({ status: 200, profile: { ...staff, role: 'CUSTOMER' } });
    expect((await handleOperationsJobs(new Request('http://local/api/operations/jobs'))).status).toBe(403);
    session.mockResolvedValue({ status: 200, profile: staff });
    expect((await handleOperationsJobs(new Request('http://local/api/operations/jobs?status=unknown'))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });

  it('enforces same-origin and server-side CSRF before requesting a retry', async () => {
    const foreign = new Request(`http://local/api/operations/jobs/${recordId}/retry`, { method: 'POST', headers: { origin: 'https://evil.test' } });
    expect((await handleOperationsRetry(foreign, recordId)).status).toBe(403);
    backend.mockResolvedValueOnce(Response.json({ csrfToken: csrf })).mockResolvedValueOnce(Response.json({ status: 'queued', jobId: eventId }));
    const own = new Request(`http://local/api/operations/jobs/${recordId}/retry`, { method: 'POST', headers: { origin: 'http://local', 'sec-fetch-site': 'same-origin' } });
    const response = await handleOperationsRetry(own, recordId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'queued', jobId: eventId });
    expect(backend).toHaveBeenNthCalledWith(1, 'auth/csrf');
    expect(backend).toHaveBeenNthCalledWith(2, `ops/jobs/${recordId}/retry`, expect.objectContaining({ method: 'POST', headers: { 'x-csrf-token': csrf } }));
  });

  it('explains when an unavailable queue may leave a durable retry intent pending', async () => {
    backend.mockResolvedValueOnce(Response.json({ csrfToken: csrf })).mockResolvedValueOnce(Response.json({ message: 'internal queue host failed' }, { status: 503 }));
    const own = new Request(`http://local/api/operations/jobs/${recordId}/retry`, { method: 'POST', headers: { origin: 'http://local' } });
    const response = await handleOperationsRetry(own, recordId);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.message).toMatch(/retry intent may remain pending/i);
    expect(JSON.stringify(body)).not.toContain('internal queue host');
  });

  it('paginates audit events while allowlisting known safe context', async () => {
    backend.mockResolvedValueOnce(Response.json({
      data: [{ id: recordId, action: 'idempotency_conflict', actorId: 'user-id', actorType: 'user', entityId: eventId, entityType: 'transfer_attempt', outcome: 'REJECTED', occurredAt: '2026-10-27T10:00:00Z', metadata: { amountMinor: '1200', reason: 'KEY_PAYLOAD_MISMATCH', keyFingerprint: 'secret-hash', raw: 'private' } }],
      pagination: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
    }));
    const response = await handleOperationsAudit(new Request('http://local/api/operations/audit?page=2&pageSize=10&search=transfer&from=2026-10-27&to=2026-10-27'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data[0].context).toEqual({ amountMinor: '1200', reason: 'KEY_PAYLOAD_MISMATCH' });
    expect(JSON.stringify(body)).not.toContain('secret-hash');
    expect(JSON.stringify(body)).not.toContain('private');
    expect(backend).toHaveBeenCalledWith('audit-events/search?page=2&pageSize=10&search=transfer&from=2026-10-27&to=2026-10-27');
  });

  it('validates genuine reconciliation reports and strips unexpected issue fields', async () => {
    backend.mockResolvedValueOnce(Response.json({ reportId: recordId, checkedAt: '2026-10-27T10:00:00Z', accountCount: '8', journalCount: '12', walletCount: '7', ok: false, issues: [{ code: 'WALLET_BALANCE_MISMATCH', resourceType: 'wallet', resourceId: eventId, detail: { ledgerTotalMinor: '100', projectedBalanceMinor: '90', secret: 'no' }, sensitivePayload: 'no' }] }));
    const response = await handleOperationsReconciliation();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.issues[0]).toEqual({ code: 'WALLET_BALANCE_MISMATCH', resourceType: 'wallet', resourceId: eventId, detail: { ledgerTotalMinor: '100', projectedBalanceMinor: '90' } });
    expect(JSON.stringify(body)).not.toContain('sensitivePayload');
  });

  it('returns a generic service-unavailable state when the backend is offline', async () => {
    backend.mockRejectedValueOnce(new Error('connection refused; internal host and credentials'));
    const response = await handleOperationsJob(recordId);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('credentials');
  });
});
