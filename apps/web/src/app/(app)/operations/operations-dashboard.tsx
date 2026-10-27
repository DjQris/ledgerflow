'use client';

import { BarPicker } from 'panelui-web/bar-picker';
import { DayGrid } from 'panelui-web/day-grid';
import { Stat } from 'panelui-web/stat';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent } from 'react';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { MoneyDisplay } from '@/components/money-display';
import { StatusBadge } from '@/components/status-badge';
import { useOperationsMetrics } from '@/lib/operations/hooks';

function quantity(value: number) {
  return new Intl.NumberFormat().format(value);
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase();
}

export function OperationsDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const metrics = useOperationsMetrics(from, to);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams(params.toString());
    for (const key of ['from', 'to'] as const) {
      const value = values.get(key);
      if (typeof value === 'string' && value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${pathname}?${next}`);
  }

  if (metrics.isPending) return <LoadingState label="Loading operational metrics" />;
  if (metrics.isError) return <ErrorState title="Operational data is unavailable" description="The protected metrics service could not be reached. No sample data is shown." onRetry={() => { void metrics.refetch(); }} />;

  const data = metrics.data;
  const daily = data.daily;
  const maxCount = Math.max(1, ...daily.map((day) => day.completedCount + day.failedCount));
  const completedBars = daily.map((day) => ({ label: day.date.slice(-2), name: day.date, value: day.completedCount }));
  const failedBars = daily.map((day) => ({ label: day.date.slice(-2), name: day.date, value: day.failedCount }));
  const dayCells = daily.map((day) => {
    const total = day.completedCount + day.failedCount;
    const level = total === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((total / maxCount) * 4)));
    return { level: level as 0 | 1 | 2 | 3 | 4, label: `${day.date}, ${total} recorded transfers` };
  });
  const fromLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${data.from}T00:00:00Z`));
  const toLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${data.to}T00:00:00Z`));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Transfer period: {fromLabel}–{toLabel} (UTC)</p>
        <StatusBadge label={data.apiReadiness === 'ready' ? 'API and database ready' : 'Readiness unavailable'} tone={data.apiReadiness === 'ready' ? 'success' : 'warning'} />
      </div>

      <form key={`${data.from}|${data.to}`} aria-label="Dashboard date range" onSubmit={applyRange} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="grid gap-1 text-sm font-medium">From (UTC)
          <input aria-label="From date" name="from" type="date" required max={to ?? data.to} defaultValue={from ?? data.from} className="h-10 rounded-md border border-input bg-background px-3" />
        </label>
        <label className="grid gap-1 text-sm font-medium">To (UTC)
          <input aria-label="To date" name="to" type="date" required min={from ?? data.from} defaultValue={to ?? data.to} className="h-10 rounded-md border border-input bg-background px-3" />
        </label>
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">Apply range</button>
        {metrics.isFetching && <span role="status" className="text-sm text-muted-foreground">Refreshing…</span>}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat className="min-w-0"><Stat.Content><Stat.Label>Completed transfer value</Stat.Label><Stat.Value size="md"><MoneyDisplay amountMinor={data.completedMinor} /></Stat.Value><Stat.Description>Settled within selected period</Stat.Description></Stat.Content></Stat>
        <Stat className="min-w-0"><Stat.Content><Stat.Label>Completed transfers</Stat.Label><Stat.Value>{quantity(data.completedCount)}</Stat.Value><Stat.Description>Counted by completion time</Stat.Description></Stat.Content></Stat>
        <Stat className="min-w-0"><Stat.Content><Stat.Label>Recorded failed transfers</Stat.Label><Stat.Value>{quantity(data.recordedFailedTransferCount)}</Stat.Value><Stat.Description>Persisted failure rows in period</Stat.Description></Stat.Content></Stat>
        <Stat className="min-w-0"><Stat.Content><Stat.Label>Registered user accounts</Stat.Label><Stat.Value>{quantity(data.registeredUsers)}</Stat.Value><Stat.Description>All account statuses</Stat.Description></Stat.Content></Stat>
        <Stat className="min-w-0"><Stat.Content><Stat.Label>Pending operational work</Stat.Label><Stat.Value>{quantity(data.pendingRetries + data.pendingOutboxEvents)}</Stat.Value><Stat.Description>{quantity(data.pendingRetries)} retries · {quantity(data.pendingOutboxEvents)} outbox events</Stat.Description></Stat.Content></Stat>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DataPanel title="Daily activity" description={`Relative daily volume across ${daily.length} UTC days; exact counts are listed below.`}>
          {daily.every((day) => day.completedCount + day.failedCount === 0) ? <EmptyState title="No transfer activity in this period" description="Recorded transfers will appear here when present in the backend." /> : (
            <div className="space-y-3"><DayGrid cells={dayCells} columns={7} color="primary" label="Daily transfer volume" /><DayGrid.Legend less="Fewer" more="More" /><p className="text-xs text-muted-foreground">DayGrid size is scaled to the busiest day in this selected range. Completed and recorded failed counts are separated in the trend panels.</p></div>
          )}
        </DataPanel>
        <DataPanel title="Success and failure by day" description="Completed transfers are grouped by completion day; recorded failures are grouped by record creation day.">
          {daily.length === 0 || daily.every((day) => day.completedCount + day.failedCount === 0) ? <EmptyState title="No daily transfer data" description="There are no recorded transfers in this selected period." /> : (
            <div className="space-y-5">
              <div><h3 className="mb-2 text-sm font-medium">Completed transfers</h3><BarPicker data={completedBars} max={Math.max(1, ...daily.map((day) => day.completedCount))} color="success" label="Daily completed transfer count" formatValue={(value) => `${quantity(value)} completed transfers`} className="overflow-x-auto" /></div>
              <div><h3 className="mb-2 text-sm font-medium">Recorded failed transfers</h3><BarPicker data={failedBars} max={Math.max(1, ...daily.map((day) => day.failedCount))} color="destructive" label="Daily recorded failed transfer count" formatValue={(value) => `${quantity(value)} recorded failed transfers`} className="overflow-x-auto" /></div>
            </div>
          )}
        </DataPanel>
      </div>

      <DataPanel title="Daily transaction totals" description="Exact counts and completed transfer value for each day in the selected UTC period.">
        {daily.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">UTC day</th><th className="py-2 pr-4">Completed</th><th className="py-2 pr-4">Recorded failed</th><th className="py-2 text-right">Completed value</th></tr></thead><tbody>{daily.slice().reverse().map((day) => <tr key={day.date} className="border-t border-border"><td className="py-2 pr-4">{day.date}</td><td className="py-2 pr-4">{quantity(day.completedCount)}</td><td className="py-2 pr-4">{quantity(day.failedCount)}</td><td className="py-2 text-right"><MoneyDisplay amountMinor={day.completedMinor} /></td></tr>)}</tbody></table></div> : <EmptyState title="No days in this period" description="Choose a valid date range." />}
      </DataPanel>

      <DataPanel title="Recent system activity" description="Latest audit actions. Private audit metadata and actor identifiers are not displayed.">
        {data.recentActivity.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Action</th><th className="py-2 pr-4">Entity</th><th className="py-2">Outcome</th></tr></thead><tbody>{data.recentActivity.map((event, index) => <tr key={`${event.occurredAt}-${index}`} className="border-t border-border"><td className="py-2 pr-4">{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurredAt))}</td><td className="py-2 pr-4">{humanize(event.action)}</td><td className="py-2 pr-4">{humanize(event.entityType)}</td><td className="py-2">{event.outcome.toLowerCase()}</td></tr>)}</tbody></table></div> : <EmptyState title="No recent system activity" description="New audit events will appear here when present." />}
      </DataPanel>
    </div>
  );
}
