'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { ErrorState, LoadingState } from '@/components/states';
import { MoneyDisplay } from '@/components/money-display';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useTransactionDetails } from '@/lib/customer/hooks';
import { ApiError } from '@/lib/auth/client';

function tone(status: string): StatusTone {
  if (['COMPLETED', 'POSTED'].includes(status)) return 'success';
  if (status === 'PENDING') return 'warning';
  if (['FAILED', 'VOIDED'].includes(status)) return 'destructive';
  return 'neutral';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

export function TransactionDetails({
  transactionId,
}: {
  transactionId: string;
}) {
  const query = useTransactionDetails(transactionId);
  const searchParams = useSearchParams();
  const historyQuery = searchParams.toString();
  const historyHref = `/transactions${historyQuery ? `?${historyQuery}` : ''}`;
  if (query.isPending)
    return <LoadingState label="Loading transaction details" />;
  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    if (status === 404)
      return (
        <div role="alert" className="rounded-xl border border-border p-6">
          <h2 className="font-semibold">Transaction not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This transaction may not exist or may not be available to your
            account.
          </p>
          <Link
            className="mt-4 inline-block text-sm font-medium text-primary underline"
            href={historyHref}
          >
            Back to transactions
          </Link>
        </div>
      );
    if (status === 403)
      return (
        <ErrorState
          title="You can’t access this transaction"
          description="Only transactions belonging to your account are available here."
        />
      );
    return (
      <ErrorState
        title="Transaction details could not be loaded"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const transaction = query.data;
  return (
    <div className="space-y-5">
      {query.isFetching && (
        <p role="status" className="text-xs text-muted-foreground">
          Refreshing transaction details…
        </p>
      )}
      <section className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Transaction amount</p>
            <p className="mt-1 text-2xl font-semibold">
              <MoneyDisplay amountMinor={transaction.amountMinor} />
            </p>
          </div>
          <StatusBadge
            label={transaction.status}
            tone={tone(transaction.status)}
          />
        </div>
        <dl className="mt-7 grid gap-5 sm:grid-cols-2">
          <Field label="Reference">
            {transaction.externalReference ?? transaction.id}
          </Field>
          <Field label="Type">{transaction.type.replaceAll('_', ' ')}</Field>
          <Field label="Date">
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: 'full',
              timeStyle: 'short',
            }).format(new Date(transaction.postedAt ?? transaction.createdAt))}
          </Field>
          <Field label="Currency">{transaction.currency}</Field>
          <Field label="Wallet">{transaction.walletId ?? '—'}</Field>
          <Field label="Source wallet">
            {transaction.sourceWalletId ?? '—'}
          </Field>
          <Field label="Destination wallet">
            {transaction.destinationWalletId ?? '—'}
          </Field>
          {transaction.description && (
            <Field label="Description">{transaction.description}</Field>
          )}
          <Field label="Transaction ID">{transaction.id}</Field>
        </dl>
      </section>
      <Link
        className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        href={historyHref}
      >
        ← Back to transactions
      </Link>
    </div>
  );
}
