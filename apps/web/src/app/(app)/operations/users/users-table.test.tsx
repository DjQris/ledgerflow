import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useUsers, push, search } = vi.hoisted(() => ({ useUsers: vi.fn(), push: vi.fn(), search: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/operations/users', useSearchParams: () => search.current }));
vi.mock('@/lib/operations/hooks', () => ({ useAdminUsers: useUsers }));

import { useAdminUsers } from '@/lib/operations/hooks';
import { AdminUsersTable } from './users-table';

const users = vi.mocked(useAdminUsers);
const id = 'a5e0df47-36f4-4314-8a04-71464ba8996c';
const page = { data: [{ id, email: 'person@example.test', role: 'CUSTOMER' as const, status: 'ACTIVE' as const, createdAt: '2026-10-01T00:00:00Z' }], pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 } };

describe('AdminUsersTable', () => {
  beforeEach(() => {
    push.mockReset();
    search.current = new URLSearchParams('role=CUSTOMER&status=ACTIVE&page=1');
    users.mockReturnValue({ data: page, isPending: false, isError: false, isFetching: false } as ReturnType<typeof useAdminUsers>);
  });
  afterEach(cleanup);

  it('shows safe identity, mobile and desktop layouts, and preserves filters for detail links', () => {
    const { container } = render(<AdminUsersTable />);
    expect(screen.getAllByText('person@example.test')).toHaveLength(2);
    expect(screen.getByText('CUSTOMER · Created Oct 1, 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', `/operations/users/${id}?role=CUSTOMER&status=ACTIVE&page=1`);
    expect(container.querySelector('.hidden.overflow-x-auto')).toBeInTheDocument();
    expect(container.querySelector('.grid.gap-3.md\\:hidden')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('searches and pages through URL state while keeping current filters', async () => {
    const user = userEvent.setup();
    render(<AdminUsersTable />);
    await user.type(screen.getByRole('searchbox', { name: 'Email search' }), 'person@example.test');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(push).toHaveBeenCalledWith('/operations/users?search=person%40example.test&role=CUSTOMER&status=ACTIVE');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(push).toHaveBeenLastCalledWith('/operations/users?role=CUSTOMER&status=ACTIVE&page=2');
    expect(users).toHaveBeenCalledWith(expect.objectContaining({ page: 1, search: undefined, role: 'CUSTOMER', status: 'ACTIVE' }));
  });

  it('shows empty, loading, and backend/authorization error states', () => {
    users.mockReturnValue({ data: { ...page, data: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } }, isPending: false, isError: false } as unknown as ReturnType<typeof useAdminUsers>);
    const empty = render(<AdminUsersTable />);
    expect(screen.getByText('No matching user accounts')).toBeInTheDocument();
    empty.unmount();
    users.mockReturnValue({ data: undefined, isPending: true, isError: false } as unknown as ReturnType<typeof useAdminUsers>);
    const loading = render(<AdminUsersTable />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading user records');
    loading.unmount();
    users.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useAdminUsers>);
    render(<AdminUsersTable />);
    expect(screen.getByText('User records are unavailable')).toBeInTheDocument();
  });
});
