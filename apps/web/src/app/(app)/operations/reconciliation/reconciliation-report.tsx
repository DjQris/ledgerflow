'use client';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { useLedgerReconciliation } from '@/lib/operations/center-hooks';

function date(value: string) { return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))} UTC`; }
function issueTitle(code: string) { return code.toLowerCase().replaceAll('_', ' '); }

export function ReconciliationReport() {
  const report = useLedgerReconciliation();
  if (report.isPending) return <LoadingState label="Running ledger integrity verification" />;
  if (report.isError && !report.data) return <ErrorState title="Reconciliation service unavailable" description="The protected ledger verifier did not return a report. No ledger changes were attempted." onRetry={() => { void report.refetch(); }} />;
  const result = report.data;
  if (!result) return null;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-xs text-muted-foreground">Report checked {date(result.checkedAt)}{report.isFetching ? ' · running a new check…' : report.isStale ? ' · may be stale' : ''}</p><button type="button" disabled={report.isFetching} onClick={() => { void report.refetch(); }} className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-60">{report.isFetching ? 'Checking…' : 'Run verification again'}</button></div>
    {report.isError && <ErrorState title="Refresh failed; showing the prior report" description="The displayed result is the last successful verification and may be stale. No corrections were made." onRetry={() => { void report.refetch(); }} />}
    <DataPanel title="Verification report" description="Run ID identifies this check response; reports are not persisted as a historical ledger store.">
      <div className="flex flex-wrap items-center gap-3"><StatusBadge label={result.ok ? 'Balanced · no discrepancies' : 'Discrepancies found'} tone={result.ok ? 'success' : 'warning'} /><span className="break-all font-mono text-xs text-muted-foreground">Report ID: {result.reportId}</span></div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Executed', date(result.checkedAt)], ['Ledger accounts checked', result.accountCount],
        ['Posted journals checked', result.journalCount], ['Wallets checked', result.walletCount],
      ].map(([label, value]) => <div key={label} className="space-y-1"><dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt><dd className="break-all text-sm">{value}</dd></div>)}</dl>
    </DataPanel>
    <DataPanel title="Related discrepancy records" description="Issues are read-only findings from the backend verifier. No automatic or silent corrections are performed.">
      {!result.issues.length ? <EmptyState title="No integrity discrepancies found" description="The verifier reported balanced posted journals and wallet projections for the checked records." /> : <ul className="grid gap-3">{result.issues.map((issue, index) => <li key={`${issue.resourceId}-${issue.code}-${index}`} className="space-y-2 rounded-lg border border-warning/40 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium capitalize">{issueTitle(issue.code)}</p><StatusBadge label={issue.resourceType} tone="warning" /></div><p className="break-all font-mono text-xs">Record: {issue.resourceId}</p><dl className="grid gap-2 sm:grid-cols-2">{Object.entries(issue.detail).map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{issueTitle(key)}</dt><dd className="font-mono text-sm">{value}</dd></div>)}</dl></li>)}</ul>}
    </DataPanel>
  </div>;
}
