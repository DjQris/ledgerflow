import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useUser, useRole, useStatus } = vi.hoisted(() => ({ useUser: vi.fn(), useRole: vi.fn(), useStatus: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('page=2&search=person&unknown=ignored') }));
vi.mock('@/lib/operations/hooks', () => ({ useAdminUser: useUser, useUpdateAdminUserRole: useRole, useUpdateAdminUserStatus: useStatus }));

import { useAdminUser, useUpdateAdminUserRole, useUpdateAdminUserStatus } from '@/lib/operations/hooks';
import { AdminUserDetails } from './user-details';

const userHook = vi.mocked(useAdminUser);
const roleHook = vi.mocked(useUpdateAdminUserRole);
const statusHook = vi.mocked(useUpdateAdminUserStatus);
const userId = 'c2b311df-6a7a-49c5-a6a0-b2ccb6b5cc66';
const record = { id: userId, email: 'person@example.test', role: 'CUSTOMER' as const, status: 'ACTIVE' as const, createdAt: '2026-10-01T00:00:00Z' };
const roleMutation = { mutateAsync: vi.fn(), isPending: false, isError: false };
const statusMutation = { mutateAsync: vi.fn(), isPending: false, isError: false };

describe('AdminUserDetails', () => {
  beforeEach(() => {
    userHook.mockReturnValue({ data: record, isPending: false, isError: false, isFetching: false } as ReturnType<typeof useAdminUser>);
    roleMutation.mutateAsync.mockReset();
    roleMutation.mutateAsync.mockResolvedValue(record);
    statusMutation.mutateAsync.mockReset();
    statusMutation.mutateAsync.mockResolvedValue(record);
    roleHook.mockReturnValue(roleMutation as unknown as ReturnType<typeof useUpdateAdminUserRole>);
    statusHook.mockReturnValue(statusMutation as unknown as ReturnType<typeof useUpdateAdminUserStatus>);
  });
  afterEach(cleanup);

  it('confirms and applies role changes and account suspension', async () => {
    const user = userEvent.setup();
    render(<AdminUserDetails userId={userId} actorId="another-admin" actor={{ id: 'another-admin', email: 'admin@example.test', role: 'ADMIN' }} />);
    expect(screen.getByText('person@example.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to users/ })).toHaveAttribute('href', '/operations/users?page=2&search=person');
    await user.selectOptions(screen.getByRole('combobox', { name: 'New role' }), 'OPERATIONS');
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm role change' }));
    expect(roleMutation.mutateAsync).toHaveBeenCalledWith('OPERATIONS');
    expect(await screen.findByText('Role changed to OPERATIONS.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));
    await user.click(await screen.findByRole('button', { name: /^Suspend account$/ }));
    expect(statusMutation.mutateAsync).toHaveBeenCalledWith('SUSPENDED');
  });

  it('prevents self-management and shows reactivation confirmation for suspended accounts', async () => {
    userHook.mockReturnValue({ data: { ...record, id: 'admin-id', status: 'SUSPENDED' }, isPending: false, isError: false } as ReturnType<typeof useAdminUser>);
    const user = userEvent.setup();
    const { rerender } = render(<AdminUserDetails userId={userId} actorId="admin-id" actor={{ id: 'admin-id', email: 'admin@example.test', role: 'ADMIN' }} />);
    expect(screen.getByText(/You cannot change your own role or status/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'New role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate account' })).not.toBeInTheDocument();

    rerender(<AdminUserDetails userId={userId} actorId="another-admin" actor={{ id: 'another-admin', email: 'admin@example.test', role: 'ADMIN' }} />);
    await user.click(screen.getByRole('button', { name: 'Reactivate account' }));
    expect(screen.getByText(/revoked sessions will not be restored/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^Reactivate account$/ }));
    expect(statusMutation.mutateAsync).toHaveBeenCalledWith('ACTIVE');
  });
});
