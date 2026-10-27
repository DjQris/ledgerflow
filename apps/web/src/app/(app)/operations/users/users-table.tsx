'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, type FormEvent } from 'react';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { useAdminUsers } from '@/lib/operations/hooks';

const roles = ['CUSTOMER', 'OPERATIONS', 'ADMIN'];
const statuses = ['ACTIVE', 'SUSPENDED'];
const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

export function AdminUsersTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = 20;
  const search = params.get('search') ?? '';
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const filters = useMemo(() => ({ page, pageSize, search: search || undefined, role: role || undefined, status: status || undefined }), [page, search, role, status]);
  const users = useAdminUsers(filters);

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams();
    for (const key of ['search', 'role', 'status'] as const) {
      const value = changes[key] === undefined ? params.get(key) : changes[key];
      if (value) next.set(key, value);
    }
    const nextPage = changes.page === undefined ? params.get('page') : changes.page;
    if (nextPage) next.set('page', nextPage);
    router.push(`${pathname}${next.size ? `?${next}` : ''}`);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('search');
    navigate({ search: typeof value === 'string' ? value.trim() || null : null, page: null });
  }

  if (users.isPending) return <LoadingState label="Loading user records" />;
  if (users.isError) return <ErrorState title="User records are unavailable" description="Only administrators can read user records. Confirm that you still have administrator access and retry." onRetry={() => { void users.refetch(); }} />;
  const records = users.data.data;
  const query = params.toString();

  return (
    <div className="space-y-5">
      <DataPanel title="Accounts" description={`${users.data.pagination.total} matching account${users.data.pagination.total === 1 ? '' : 's'}. Email, role, status, and creation date only.`}>
        <form aria-label="User filters" onSubmit={submit} className="mb-4 grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-sm font-medium">Email search
            <input key={search} aria-label="Email search" name="search" type="search" maxLength={100} defaultValue={search} placeholder="Search email" className="h-10 rounded-md border border-input bg-background px-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium">Role
            <select aria-label="Role filter" value={role} onChange={(event) => navigate({ role: event.target.value || null, page: null })} className="h-10 rounded-md border border-input bg-background px-3">
              <option value="">All roles</option>{roles.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Status
            <select aria-label="Status filter" value={status} onChange={(event) => navigate({ status: event.target.value || null, page: null })} className="h-10 rounded-md border border-input bg-background px-3">
              <option value="">All statuses</option>{statuses.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2"><button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">Search</button><button className="h-10 rounded-md border border-border px-4 text-sm" type="reset" onClick={() => { window.setTimeout(() => navigate({ search: null, role: null, status: null, page: null }), 0); }}>Clear</button></div>
        </form>
        {users.isFetching && <p role="status" className="mb-3 text-xs text-muted-foreground">Refreshing user records…</p>}
        {records.length ? <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">Email</th><th className="py-2 pr-4">Role</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Created</th><th className="py-2">Details</th></tr></thead>
              <tbody>{records.map((user) => <tr key={user.id} className="border-t border-border"><td className="max-w-80 truncate py-3 pr-4" title={user.email}>{user.email}</td><td className="py-3 pr-4">{user.role}</td><td className="py-3 pr-4"><StatusBadge label={user.status} tone={user.status === 'ACTIVE' ? 'success' : 'neutral'} /></td><td className="py-3 pr-4">{date(user.createdAt)}</td><td className="py-3"><Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/operations/users/${user.id}${query ? `?${query}` : ''}`}>View</Link></td></tr>)}</tbody>
            </table>
          </div>
          <ul className="grid gap-3 md:hidden">{records.map((user) => <li key={user.id} className="rounded-lg border border-border p-4"><div className="flex items-start justify-between gap-3"><p className="break-all text-sm font-medium">{user.email}</p><StatusBadge label={user.status} tone={user.status === 'ACTIVE' ? 'success' : 'neutral'} /></div><p className="mt-2 text-sm text-muted-foreground">{user.role} · Created {date(user.createdAt)}</p><Link className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-primary underline" href={`/operations/users/${user.id}${query ? `?${query}` : ''}`}>User details</Link></li>)}</ul>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3"><p aria-live="polite" className="text-sm text-muted-foreground">Page {users.data.pagination.page} of {Math.max(1, users.data.pagination.totalPages)}</p><div className="flex gap-2"><button className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50" disabled={page <= 1 || users.isFetching} onClick={() => navigate({ page: String(page - 1) })}>Previous</button><button className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50" disabled={page >= users.data.pagination.totalPages || users.isFetching} onClick={() => navigate({ page: String(page + 1) })}>Next</button></div></div>
        </> : <EmptyState title="No matching user accounts" description="Try changing the email, role, or status filters." />}
      </DataPanel>
    </div>
  );
}
