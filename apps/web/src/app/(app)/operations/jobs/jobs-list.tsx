'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/auth/client';
import { useOperationsJobs } from '@/lib/operations/center-hooks';
import type { OperationsJob } from '@/lib/operations/center-client';

function date(value: string) { return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`; }
function statusTone(status: OperationsJob['status']): 'warning' | 'success' | 'neutral' { return status === 'dead_letter' ? 'warning' : status === 'resolved' ? 'success' : 'neutral'; }

export function OperationsJobsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get('status') ?? '';
  const source = params.get('source') ?? '';
  const eventType = params.get('eventType') ?? '';
  const filter = useMemo(() => ({ limit: 100, status: (status || undefined) as OperationsJob['status'] | undefined, source: (source || undefined) as OperationsJob['source'] | undefined, eventType: eventType || undefined }), [eventType, source, status]);
  const jobs = useOperationsJobs(filter);
  function apply(name: 'status' | 'source' | 'eventType', value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value); else next.delete(name);
    router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  const refresh = <button type="button" disabled={jobs.isFetching} onClick={() => { void jobs.refetch(); }} className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-60">{jobs.isFetching ? 'Refreshing…' : 'Refresh'}</button>;
  if (jobs.isPending) return <LoadingState label="Loading failed background jobs" />;
  if (jobs.isError) {
    const denied = jobs.error instanceof ApiError && jobs.error.status === 403;
    return <ErrorState title={denied ? 'Operations access required' : 'Background jobs are unavailable'} description={denied ? 'Your account cannot inspect background jobs.' : 'The protected queue inspection service did not respond. No retry was submitted.'} onRetry={() => { void jobs.refetch(); }} />;
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-xs text-muted-foreground">Last checked {jobs.dataUpdatedAt ? date(new Date(jobs.dataUpdatedAt).toISOString()) : 'not checked yet'}{jobs.isFetching ? ' · refreshing' : jobs.isStale ? ' · may be stale' : ''}</p>{refresh}</div>
    <DataPanel title="Failed and recovering jobs" description="Latest 100 durable failure records. Failure reasons are sanitized reason codes; processing status comes from the outbox.">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">Status<select aria-label="Job status filter" value={status} onChange={(event) => apply('status', event.target.value)} className="h-10 rounded-md border border-input bg-background px-3"><option value="">All statuses</option><option value="retrying">Retrying</option><option value="dead_letter">Dead letter</option><option value="retry_pending">Retry pending</option><option value="resolved">Resolved</option></select></label>
        <label className="grid gap-1 text-sm font-medium">Processor<select aria-label="Processor filter" value={source} onChange={(event) => apply('source', event.target.value)} className="h-10 rounded-md border border-input bg-background px-3"><option value="">All processors</option><option value="dispatcher">Dispatcher</option><option value="worker">Worker</option></select></label>
        <label className="grid gap-1 text-sm font-medium">Event type<select aria-label="Event type filter" value={eventType} onChange={(event) => apply('eventType', event.target.value)} className="h-10 rounded-md border border-input bg-background px-3"><option value="">All event types</option><option value="transfer.completed">transfer.completed</option></select></label>
      </div>
      {!jobs.data.length ? <EmptyState title="No matching background jobs" description="No failure records match these filters. This is a real empty result from the operations API." /> : <>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[850px] text-left text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">Job ID</th><th className="py-2 pr-4">Event</th><th className="py-2 pr-4">Processor</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Attempts</th><th className="py-2 pr-4">Last failure</th><th className="py-2 pr-4">Reason</th><th className="py-2">Details</th></tr></thead><tbody>{jobs.data.map((job) => <tr key={job.id} className="border-t border-border"><td className="max-w-44 truncate py-3 pr-4 font-mono text-xs" title={job.jobId}>{job.jobId}</td><td className="py-3 pr-4">{job.eventType ?? 'Unknown event'}</td><td className="py-3 pr-4 capitalize">{job.source}</td><td className="py-3 pr-4"><StatusBadge label={job.status.replaceAll('_', ' ')} tone={statusTone(job.status)} /></td><td className="py-3 pr-4">{job.attempts}</td><td className="py-3 pr-4">{date(job.lastFailureAt)}</td><td className="py-3 pr-4 font-mono text-xs">{job.failureReason}</td><td><Link className="text-primary underline" href={`/operations/jobs/${job.id}`}>Inspect</Link></td></tr>)}</tbody></table></div>
        <ul className="grid gap-3 md:hidden">{jobs.data.map((job) => <li key={job.id} className="space-y-2 rounded-lg border border-border p-4"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{job.source} · {job.eventType ?? 'Unknown event'}</span><StatusBadge label={job.status.replaceAll('_', ' ')} tone={statusTone(job.status)} /></div><p className="break-all font-mono text-xs">{job.jobId}</p><p className="text-sm">{job.attempts} attempts · last failure {date(job.lastFailureAt)}</p><p className="font-mono text-xs text-muted-foreground">{job.failureReason}</p><Link className="inline-flex min-h-10 items-center text-sm text-primary underline" href={`/operations/jobs/${job.id}`}>Inspect job</Link></li>)}</ul>
      </>}
    </DataPanel>
  </div>;
}
