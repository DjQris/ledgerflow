import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/auth/client';

const { useJob, useRetry } = vi.hoisted(() => ({ useJob: vi.fn(), useRetry: vi.fn() }));
vi.mock('@/lib/operations/center-hooks', () => ({ useOperationsJob: useJob, useRetryOperationsJob: useRetry }));

import { useOperationsJob, useRetryOperationsJob } from '@/lib/operations/center-hooks';
import { OperationsJobDetail } from './job-detail';

const jobHook = vi.mocked(useOperationsJob);
const retryHook = vi.mocked(useRetryOperationsJob);
const job = { id: 'a5e0df47-36f4-4314-8a04-71464ba8996c', eventId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', jobId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', source: 'worker' as const, eventType: 'transfer.completed', transferId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', processingStatus: 'published', transferStatus: 'completed', eventCreatedAt: '2026-10-27T09:00:00Z', failureCategory: 'temporary' as const, failureReason: 'PROCESSING_FAILED', attempts: 3, firstFailureAt: '2026-10-27T09:01:00Z', lastFailureAt: '2026-10-27T09:02:00Z', updatedAt: '2026-10-27T09:02:00Z', status: 'dead_letter' as const, retryActorId: null };
const mutation = { mutateAsync: vi.fn(), isPending: false, isError: false, error: null as Error | null };

describe('OperationsJobDetail', () => {
  beforeEach(() => {
    jobHook.mockReturnValue({ data: job, dataUpdatedAt: Date.parse('2026-10-27T10:00:00Z'), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsJob>);
    mutation.mutateAsync.mockReset(); mutation.mutateAsync.mockResolvedValue({ status: 'queued', jobId: job.jobId });
    retryHook.mockReturnValue(mutation as unknown as ReturnType<typeof useRetryOperationsJob>);
  });
  afterEach(cleanup);

  it('requires confirmation, submits only the retry intent, and reports the actual result', async () => {
    const user = userEvent.setup();
    render(<OperationsJobDetail id={job.id} />);
    expect(screen.getByText(/never invokes the transfer endpoint or repeats financial ledger writes/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request retry' }));
    expect(screen.getByText(/will not repeat the original financial transfer/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Confirm retry' }));
    expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Retry was accepted by the queue/)).toBeInTheDocument();
  });

  it('hides retry controls for in-progress jobs and surfaces concurrent eligibility conflicts', async () => {
    jobHook.mockReturnValue({ data: { ...job, status: 'retrying' }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsJob>);
    const { rerender } = render(<OperationsJobDetail id={job.id} />);
    expect(screen.getByText(/not in a retryable state/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request retry' })).not.toBeInTheDocument();
    jobHook.mockReturnValue({ data: job, isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsJob>);
    mutation.isError = true;
    mutation.error = new ApiError(409, 'The operation is no longer eligible. Refresh the record and review its status.');
    retryHook.mockReturnValue(mutation as unknown as ReturnType<typeof useRetryOperationsJob>);
    rerender(<OperationsJobDetail id={job.id} />);
    expect(screen.getByText('Retry is no longer eligible')).toBeInTheDocument();
  });
});
