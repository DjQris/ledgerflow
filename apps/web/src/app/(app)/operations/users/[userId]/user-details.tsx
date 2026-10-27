'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { DataPanel } from '@/components/data-panel';
import { ErrorState, LoadingState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/auth/client';
import { useAdminUser, useUpdateAdminUserRole, useUpdateAdminUserStatus } from '@/lib/operations/hooks';
import type { StaffUserRole, StaffUserStatus } from '@/lib/operations/client';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="break-all text-sm">{children}</dd></div>;
}

const roles: StaffUserRole[] = ['CUSTOMER', 'OPERATIONS', 'ADMIN'];

export function AdminUserDetails({ userId, actorId, actor }: { userId: string; actorId: string; actor: { id: string; email: string; role: StaffUserRole } }) {
  const searchParams = useSearchParams();
  const query = useAdminUser(userId);
  const roleChange = useUpdateAdminUserRole(userId);
  const statusChange = useUpdateAdminUserStatus(userId);
  const [nextRole, setNextRole] = useState<StaffUserRole | null>(null);
  const [notice, setNotice] = useState('');
  const historyQuery = new URLSearchParams();
  for (const key of ['page', 'search', 'role', 'status']) {
    const value = searchParams.get(key);
    if (value) historyQuery.set(key, value);
  }
  const backHref = `/operations/users${historyQuery.size ? `?${historyQuery}` : ''}`;

  if (query.isPending) return <LoadingState label="Loading user details" />;
  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    if (status === 404) return <div role="alert" className="rounded-xl border border-border p-6"><h2 className="font-semibold">User not found</h2><p className="mt-1 text-sm text-muted-foreground">The account does not exist or is no longer available.</p><Link className="mt-4 inline-block text-sm text-primary underline" href={backHref}>Back to users</Link></div>;
    return <ErrorState title={status === 403 ? 'Administrator permission required' : 'User details could not be loaded'} description={status === 403 ? 'Only an administrator may inspect or change user accounts.' : 'No user information or actions are available until the service responds.'} onRetry={() => { void query.refetch(); }} />;
  }

  const user = query.data;
  const isSelf = actorId === user.id;
  const pending = roleChange.isPending || statusChange.isPending;
  async function applyStatus(status: StaffUserStatus) {
    setNotice('');
    try { await statusChange.mutateAsync(status); setNotice(status === 'SUSPENDED' ? 'Account suspended. Active sessions were revoked.' : 'Account reactivated. The user must sign in again.'); }
    catch { /* Mutation error remains visible below. */ }
  }
  async function applyRole(role: StaffUserRole) {
    setNotice('');
    try { await roleChange.mutateAsync(role); setNextRole(null); setNotice(`Role changed to ${role}.`); }
    catch { /* Mutation error remains visible below. */ }
  }

  return (
    <div className="space-y-5">
      {query.isFetching && <p role="status" className="text-xs text-muted-foreground">Refreshing user details…</p>}
      {notice && <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">{notice}</p>}
      {roleChange.isError && <ErrorState title="Role change was not completed" description={roleChange.error instanceof Error ? roleChange.error.message : 'The server rejected this change.'} />}
      {statusChange.isError && <ErrorState title="Status change was not completed" description={statusChange.error instanceof Error ? statusChange.error.message : 'The server rejected this change.'} />}
      <DataPanel title="Safe identity details" description="Password hashes, credentials, tokens, and private audit data are never returned here.">
        <dl className="grid gap-5 sm:grid-cols-2">
          <Field label="Email">{user.email}</Field>
          <Field label="User ID">{user.id}</Field>
          <Field label="Role">{user.role}</Field>
          <Field label="Status"><StatusBadge label={user.status} tone={user.status === 'ACTIVE' ? 'success' : 'neutral'} /></Field>
          <Field label="Created">{new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(user.createdAt))}</Field>
        </dl>
      </DataPanel>

      <DataPanel title="Account access" description="Changes are authorized and committed by the admin API; this screen does not edit balances or ledger entries.">
        {isSelf ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">You cannot change your own role or status. Choose another administrator to manage your access.</p> : (
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1 text-sm font-medium"><label htmlFor="new-role">Role</label><select id="new-role" aria-label="New role" value={nextRole ?? user.role} onChange={(event) => setNextRole(event.target.value as StaffUserRole)} disabled={pending} className="h-10 rounded-md border border-input bg-background px-3">{roles.map((role) => <option key={role}>{role}</option>)}</select></div>
            {nextRole && nextRole !== user.role && <ConfirmationDialog triggerLabel="Change role" title="Confirm role change" description={`Change ${user.email} from ${user.role} to ${nextRole}? Access will follow the new role immediately.`} confirmLabel={pending ? 'Updating…' : 'Confirm role change'} disabled={pending} onConfirm={() => { void applyRole(nextRole); }} />}
            <ConfirmationDialog triggerLabel={user.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate account'} title={user.status === 'ACTIVE' ? 'Confirm account suspension' : 'Confirm account reactivation'} description={user.status === 'ACTIVE' ? `Suspend ${user.email}? Active sessions and refresh tokens will be revoked. This cannot be undone for those sessions.` : `Reactivate ${user.email}? The user must sign in again; revoked sessions will not be restored.`} confirmLabel={pending ? 'Updating…' : user.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate account'} disabled={pending} onConfirm={() => { void applyStatus(user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'); }} />
          </div>
        )}
      </DataPanel>
      <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline" href={backHref}>← Back to users</Link>
      <p className="sr-only">Signed in as {actor.email}, role {actor.role}.</p>
    </div>
  );
}
