'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FormEvent } from 'react';
import { useMemo } from 'react';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/auth/client';
import { useOperationsAudit } from '@/lib/operations/center-hooks';
import type { AuditEvent } from '@/lib/operations/center-client';

function date(value: string) { return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`; }
function context(event: AuditEvent) { return event.context ? Object.entries(event.context).map(([key, value]) => `${key}: ${value}`).join(' · ') : '—'; }

export function OperationsAudit() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = 20;
  const search = params.get('search') ?? '';
  const action = params.get('action') ?? '';
  const entityType = params.get('entityType') ?? '';
  const outcome = params.get('outcome') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const filter = useMemo(() => ({ page, pageSize, search: search || undefined, action: action || undefined, entityType: entityType || undefined, outcome: (outcome || undefined) as 'SUCCEEDED' | 'REJECTED' | undefined, from: from || undefined, to: to || undefined }), [action, entityType, from, outcome, page, pageSize, search, to]);
  const events = useOperationsAudit(filter);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['search', 'action', 'entityType', 'outcome', 'from', 'to'] as const) {
      const value = form.get(key);
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    }
    router.push(`${pathname}?${next}`, { scroll: false });
  }
  function goPage(value: number) {
    const next = new URLSearchParams(params.toString());
    next.set('page', String(value));
    router.push(`${pathname}?${next}`, { scroll: false });
  }
  if (events.isPending) return <LoadingState label="Loading audit events" />;
  if (events.isError) {
    const denied = events.error instanceof ApiError && events.error.status === 403;
    return <ErrorState title={denied ? 'Operations access required' : 'Audit service unavailable'} description={denied ? 'Your account cannot inspect audit events.' : 'The protected audit service did not respond. Audit records remain read-only.'} onRetry={() => { void events.refetch(); }} />;
  }
  const totalPages = Math.max(1, events.data.pagination.totalPages);
  const refresh = <button type="button" disabled={events.isFetching} onClick={() => { void events.refetch(); }} className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-60">{events.isFetching ? 'Refreshing…' : 'Refresh'}</button>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-xs text-muted-foreground">Last checked {events.dataUpdatedAt ? date(new Date(events.dataUpdatedAt).toISOString()) : 'not checked yet'}{events.isFetching ? ' · refreshing' : events.isStale ? ' · may be stale' : ''}</p>{refresh}</div>
    <DataPanel title="Audit trail" description={`${events.data.pagination.total} matching records. Search actor/resource IDs, action, or entity type. The endpoint is read-only and returns sanitized context only.`}>
      <form key={`${search}|${action}|${entityType}|${outcome}|${from}|${to}`} aria-label="Audit filters" onSubmit={submit} className="mb-4 grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-sm font-medium">Search<input name="search" type="search" maxLength={100} defaultValue={search} aria-label="Search audit" placeholder="Actor, resource ID, action" className="h-10 rounded-md border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm font-medium">Action contains<input name="action" maxLength={100} defaultValue={action} aria-label="Action filter" className="h-10 rounded-md border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm font-medium">Resource type<input name="entityType" maxLength={100} defaultValue={entityType} aria-label="Resource type filter" className="h-10 rounded-md border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm font-medium">Outcome<select name="outcome" defaultValue={outcome} aria-label="Outcome filter" className="h-10 rounded-md border border-input bg-background px-3"><option value="">All outcomes</option><option value="SUCCEEDED">Succeeded</option><option value="REJECTED">Rejected</option></select></label>
        <label className="grid gap-1 text-sm font-medium">From (UTC)<input name="from" type="date" defaultValue={from} max={to || undefined} aria-label="Audit from date" className="h-10 rounded-md border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm font-medium">To (UTC)<input name="to" type="date" defaultValue={to} min={from || undefined} aria-label="Audit to date" className="h-10 rounded-md border border-input bg-background px-3" /></label>
        <div className="flex items-end gap-2"><button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Search</button><button type="button" onClick={() => router.push(pathname)} className="h-10 rounded-md border border-border px-4 text-sm">Clear</button></div>
      </form>
      {!events.data.data.length ? <EmptyState title="No matching audit events" description="No records match the selected filters. Audit events are immutable and are never changed from this screen." /> : <>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-left text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">Timestamp</th><th className="py-2 pr-4">Actor</th><th className="py-2 pr-4">Action</th><th className="py-2 pr-4">Resource</th><th className="py-2 pr-4">Outcome</th><th className="py-2">Safe context</th></tr></thead><tbody>{events.data.data.map((row) => <tr key={row.id} className="border-t border-border align-top"><td className="whitespace-nowrap py-3 pr-4">{date(row.occurredAt)}</td><td className="max-w-52 break-all py-3 pr-4">{row.actorType ?? 'unknown'}{row.actorId ? ` · ${row.actorId}` : ''}</td><td className="py-3 pr-4">{row.action}</td><td className="max-w-64 break-all py-3 pr-4">{row.entityType} · {row.entityId}</td><td className="py-3 pr-4"><StatusBadge label={row.outcome.toLowerCase()} tone={row.outcome === 'SUCCEEDED' ? 'success' : 'warning'} /></td><td className="max-w-72 break-words py-3 text-xs text-muted-foreground">{context(row)}</td></tr>)}</tbody></table></div>
        <ul className="grid gap-3 md:hidden">{events.data.data.map((row) => <li key={row.id} className="space-y-2 rounded-lg border border-border p-4"><div className="flex items-start justify-between gap-3"><p className="text-xs text-muted-foreground">{date(row.occurredAt)}</p><StatusBadge label={row.outcome.toLowerCase()} tone={row.outcome === 'SUCCEEDED' ? 'success' : 'warning'} /></div><p className="font-medium">{row.action}</p><p className="break-all text-sm">{row.actorType ?? 'unknown'}{row.actorId ? ` · ${row.actorId}` : ''}</p><p className="break-all text-xs text-muted-foreground">{row.entityType} · {row.entityId}</p>{row.context && <p className="break-words text-xs">{context(row)}</p>}</li>)}</ul>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3"><p aria-live="polite" className="text-sm text-muted-foreground">Page {events.data.pagination.page} of {totalPages}</p><div className="flex gap-2"><button type="button" disabled={page <= 1 || events.isFetching} onClick={() => goPage(page - 1)} className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50">Previous</button><button type="button" disabled={page >= totalPages || events.isFetching} onClick={() => goPage(page + 1)} className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50">Next</button></div></div>
      </>}
    </DataPanel>
  </div>;
}
