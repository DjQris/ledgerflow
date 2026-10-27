import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useJobs, push, search } = vi.hoisted(() => ({ useJobs: vi.fn(), push: vi.fn(), search: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/operations/jobs', useSearchParams: () => search.current }));
vi.mock('@/lib/operations/center-hooks', () => ({ useOperationsJobs: useJobs }));

import { useOperationsJobs } from '@/lib/operations/center-hooks';
import { OperationsJobsList } from './jobs-list';

const hook = vi.mocked(useOperationsJobs);
const record = { id: 'a5e0df47-36f4-4314-8a04-71464ba8996c', eventId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', jobId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', source: 'worker' as const, eventType: 'transfer.completed', transferId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', processingStatus: 'published', transferStatus: 'completed', eventCreatedAt: '2026-10-27T09:00:00Z', failureCategory: 'temporary' as const, failureReason: 'PROCESSING_FAILED', attempts: 3, firstFailureAt: '2026-10-27T09:01:00Z', lastFailureAt: '2026-10-27T09:02:00Z', updatedAt: '2026-10-27T09:02:00Z', status: 'dead_letter' as const, retryActorId: null };

describe('OperationsJobsList', () => {
  beforeEach(() => { push.mockReset(); search.current = new URLSearchParams(); hook.mockReturnValue({ data: [record], dataUpdatedAt: Date.parse('2026-10-27T10:00:00Z'), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsJobs>); });
  afterEach(cleanup);

  it('shows actual failure fields and responsive investigation links', async () => {
    const user = userEvent.setup();
    const { container } = render(<OperationsJobsList />);
    expect(screen.getAllByText(record.jobId)).toHaveLength(2);
    expect(screen.getAllByText('PROCESSING_FAILED')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Inspect' })).toHaveAttribute('href', `/operations/jobs/${record.id}`);
    expect(container.querySelector('.hidden.overflow-x-auto')).toBeInTheDocument();
    expect(container.querySelector('.grid.gap-3.md\\:hidden')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Job status filter' }), 'dead_letter');
    expect(push).toHaveBeenCalledWith('/operations/jobs?status=dead_letter', { scroll: false });
  });

  it('shows empty, loading, and unavailable queue states', () => {
    hook.mockReturnValue({ data: [], isPending: false, isError: false, isFetching: false } as unknown as ReturnType<typeof useOperationsJobs>);
    const empty = render(<OperationsJobsList />);
    expect(screen.getByText('No matching background jobs')).toBeInTheDocument();
    empty.unmount();
    hook.mockReturnValue({ data: undefined, isPending: true, isError: false } as unknown as ReturnType<typeof useOperationsJobs>);
    const loading = render(<OperationsJobsList />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading failed background jobs');
    loading.unmount();
    hook.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsJobs>);
    render(<OperationsJobsList />);
    expect(screen.getByText('Background jobs are unavailable')).toBeInTheDocument();
  });
});
