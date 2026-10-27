'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { DataPanel } from '@/components/data-panel';
import { ErrorState, LoadingState } from '@/components/states';
import { ApiError } from '@/lib/auth/client';
import { useOperationsJob, useRetryOperationsJob } from '@/lib/operations/center-hooks';

function format(value: string) { return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`; }

export function OperationsJobDetail({ id }: { id: string }) {
  const query = useOperationsJob(id);
  const retry = useRetryOperationsJob(id);
  const [notice, setNotice] = useState('');
  if (query.isPending) return <LoadingState label="Loading background job details" />;
  if (query.isError) {
    const code = query.error instanceof ApiError ? query.error.status : 0;
    return <div className="space-y-4">{code === 404 ? <ErrorState title="Job record not found" description="The failure record may have been resolved or removed from the active inspection set." /> : <ErrorState title={code === 403 ? 'Operations access required' : 'Job details are unavailable'} description={code === 403 ? 'Your account cannot inspect or retry this job.' : 'The backend did not return job details. No retry was submitted.'} onRetry={() => { void query.refetch(); }} />}<Link href="/operations/jobs" className="text-sm text-primary underline">Back to jobs</Link></div>;
  }
  const job = query.data;
  const eligibleState = job.status === 'dead_letter' || job.status === 'retry_pending';
  const retrying = retry.isPending;
  async function requestRetry() {
    setNotice('');
    try {
      const result = await retry.mutateAsync();
      const messages = {
        queued: 'Retry was accepted by the queue. The notification event will be processed asynchronously.',
        queued_for_dispatch: 'Retry is pending dispatcher pickup. The transfer and ledger will not be replayed.',
        already_processed: 'The event was already processed. The failure record has been resolved; no duplicate notification was queued.',
      };
      setNotice(messages[result.status]);
    } catch { /* The API error appears below with its real conflict/outage status. */ }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-xs text-muted-foreground">Last checked {query.dataUpdatedAt ? format(new Date(query.dataUpdatedAt).toISOString()) : 'not checked yet'}{query.isFetching ? ' · refreshing' : ''}</p><button type="button" disabled={query.isFetching} onClick={() => { void query.refetch(); }} className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-60">{query.isFetching ? 'Refreshing…' : 'Refresh'}</button></div>
    {notice && <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">{notice}</p>}
    {retry.isError && <ErrorState title={retry.error instanceof ApiError && retry.error.status === 409 ? 'Retry is no longer eligible' : retry.error instanceof ApiError && retry.error.status === 503 ? 'Queue unavailable; retry state may be pending' : 'Retry request failed'} description={retry.error instanceof Error ? retry.error.message : 'The protected API did not accept this request.'} onRetry={() => { void query.refetch(); }} />}
    <DataPanel title="Failure record" description="Failure reason is a sanitized backend code. Raw job payloads, credentials, and cookies are never shown.">
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Failure record ID', job.id], ['Job ID', job.jobId], ['Event ID', job.eventId], ['Event type', job.eventType ?? 'Unavailable'],
        ['Transfer reference', job.transferId ?? 'Unavailable'], ['Processor', job.source], ['Failure category', job.failureCategory],
        ['Failure status', job.status], ['Processing status', job.processingStatus ?? 'Unavailable'], ['Transfer status', job.transferStatus ?? 'Unavailable'],
        ['Attempts', String(job.attempts)], ['Safe failure reason', job.failureReason], ['First failure', format(job.firstFailureAt)],
        ['Last failure', format(job.lastFailureAt)], ['Record updated', format(job.updatedAt)],
        ...(job.eventCreatedAt ? [['Event created', format(job.eventCreatedAt)] as [string, string]] : []),
      ].map(([label, value]) => <div key={label} className="min-w-0 space-y-1"><dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt><dd className="break-all text-sm">{value}</dd></div>)}</dl>
    </DataPanel>
    <DataPanel title="Controlled retry" description="This action requests notification/event processing only. It never invokes the transfer endpoint or repeats financial ledger writes.">
      {eligibleState ? <div className="space-y-3"><p className="text-sm text-muted-foreground">The server will recheck current authorization, event integrity, processing state, and retry eligibility before enqueueing.</p><ConfirmationDialog triggerLabel={retrying ? 'Submitting…' : 'Request retry'} title="Confirm background retry" description="Queue the existing completion event for notification processing? This will not repeat the original financial transfer." confirmLabel={retrying ? 'Submitting…' : 'Confirm retry'} disabled={retrying} onConfirm={() => { void requestRetry(); }} /></div> : <p className="text-sm text-muted-foreground">This record is not in a retryable state. The API remains authoritative if concurrent processing changes eligibility.</p>}
    </DataPanel>
    <Link href="/operations/jobs" className="inline-flex min-h-10 items-center text-sm text-primary underline">← Back to background jobs</Link>
  </div>;
}
