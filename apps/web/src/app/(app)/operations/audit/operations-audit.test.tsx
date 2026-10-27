import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useAudit, push, search } = vi.hoisted(() => ({ useAudit: vi.fn(), push: vi.fn(), search: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/operations/audit', useSearchParams: () => search.current }));
vi.mock('@/lib/operations/center-hooks', () => ({ useOperationsAudit: useAudit }));

import { useOperationsAudit } from '@/lib/operations/center-hooks';
import { OperationsAudit } from './operations-audit';

const hook = vi.mocked(useOperationsAudit);
const page = { data: [{ id: 'a5e0df47-36f4-4314-8a04-71464ba8996c', action: 'background_retry_requested', actorId: 'operator-id', actorType: 'user', entityId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', entityType: 'failed_background_job', outcome: 'SUCCEEDED' as const, occurredAt: '2026-10-27T10:00:00Z', context: { source: 'worker', eventId: 'b5e0df47-36f4-4314-8a04-71464ba8996c' } }], pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 } };

describe('OperationsAudit', () => {
  beforeEach(() => { push.mockReset(); search.current = new URLSearchParams('page=1&outcome=SUCCEEDED'); hook.mockReturnValue({ data: page, dataUpdatedAt: Date.parse('2026-10-27T10:01:00Z'), isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsAudit>); });
  afterEach(cleanup);

  it('renders read-only audit context in responsive layouts and paginates', async () => {
    const user = userEvent.setup();
    const { container } = render(<OperationsAudit />);
    expect(screen.getAllByText('background_retry_requested')).toHaveLength(2);
    expect(screen.getAllByText(/source: worker · eventId:/)).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /edit|delete/i })).not.toBeInTheDocument();
    expect(container.querySelector('.hidden.overflow-x-auto')).toBeInTheDocument();
    expect(container.querySelector('.grid.gap-3.md\\:hidden')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(push).toHaveBeenCalledWith('/operations/audit?page=2&outcome=SUCCEEDED', { scroll: false });
  });

  it('submits bounded search and UTC date filters to URL state', async () => {
    const user = userEvent.setup();
    render(<OperationsAudit />);
    await user.type(screen.getByRole('searchbox', { name: 'Search audit' }), 'retry');
    await user.type(screen.getByRole('textbox', { name: 'Action filter' }), 'background');
    await user.type(screen.getByLabelText('Audit from date'), '2026-10-01');
    await user.type(screen.getByLabelText('Audit to date'), '2026-10-27');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(push).toHaveBeenCalledWith('/operations/audit?search=retry&action=background&outcome=SUCCEEDED&from=2026-10-01&to=2026-10-27', { scroll: false });
  });

  it('handles empty, loading, and backend-outage states', () => {
    hook.mockReturnValue({ data: { ...page, data: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } }, isPending: false, isError: false } as unknown as ReturnType<typeof useOperationsAudit>);
    const empty = render(<OperationsAudit />);
    expect(screen.getByText('No matching audit events')).toBeInTheDocument();
    empty.unmount();
    hook.mockReturnValue({ data: undefined, isPending: true, isError: false } as unknown as ReturnType<typeof useOperationsAudit>);
    const loading = render(<OperationsAudit />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading audit events');
    loading.unmount();
    hook.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsAudit>);
    render(<OperationsAudit />);
    expect(screen.getByText('Audit service unavailable')).toBeInTheDocument();
  });
});
