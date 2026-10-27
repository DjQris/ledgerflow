'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, type FormEvent } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ApiError } from '@/lib/auth/client';
import { MoneyDisplay } from '@/components/money-display';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useTransactionHistory, useWallets } from '@/lib/customer/hooks';
import type {
  TransactionHistoryFilters,
  WalletTransaction,
} from '@/lib/customer/wallet-types';

const STATUSES = [
  'PENDING',
  'POSTED',
  'VOIDED',
  'COMPLETED',
  'FAILED',
  'REVERSED',
];
const DIRECTIONS = ['INCOMING', 'OUTGOING', 'NEUTRAL'];

function tone(status: string): StatusTone {
  if (['COMPLETED', 'POSTED'].includes(status)) return 'success';
  if (['PENDING'].includes(status)) return 'warning';
  if (['FAILED', 'VOIDED'].includes(status)) return 'destructive';
  return 'neutral';
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function reference(row: WalletTransaction) {
  return row.externalReference ?? row.transactionId;
}

function TransactionCard({
  row,
  historyQuery,
}: {
  row: WalletTransaction;
  historyQuery: string;
}) {
  return (
    <article className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.type.replaceAll('_', ' ')}</p>
          <p className="truncate text-xs text-muted-foreground">
            {reference(row)}
          </p>
        </div>
        <StatusBadge label={row.status} tone={tone(row.status)} />
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {displayDate(row.postedAt ?? row.createdAt)}
        </span>
        <MoneyDisplay
          amountMinor={row.amountMinor}
          className={row.direction === 'INCOMING' ? 'text-success' : undefined}
        />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {row.direction.toLowerCase()}
          {row.counterpartyWalletId &&
            ` · wallet ••${row.counterpartyWalletId.slice(-4)}`}
        </span>
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={`/transactions/${row.transactionId}${historyQuery ? `?${historyQuery}` : ''}`}
        >
          Details
        </Link>
      </div>
    </article>
  );
}

export function TransactionHistory() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const wallets = useWallets();
  const walletIdParam = searchParams.get('walletId') ?? '';
  const activeWallet =
    wallets.data?.find((wallet) => wallet.id === walletIdParam) ??
    wallets.data?.[0];
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const filters: TransactionHistoryFilters = useMemo(
    () => ({
      page,
      pageSize: 20,
      reference: searchParams.get('reference') || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      status: searchParams.get('status') || undefined,
      direction: searchParams.get('direction') || undefined,
      sort: searchParams.get('sort') === 'asc' ? 'asc' : 'desc',
    }),
    [page, searchParams],
  );
  const history = useTransactionHistory(activeWallet?.id, filters);
  const historyQuery = searchParams.toString();
  const updateUrl = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      router.push(`${pathname}${params.size ? `?${params}` : ''}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (
      wallets.data?.length &&
      (!walletIdParam ||
        !wallets.data.some((wallet) => wallet.id === walletIdParam))
    ) {
      updateUrl({ walletId: wallets.data[0].id, page: null });
    }
  }, [wallets.data, walletIdParam, updateUrl]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reference = new FormData(event.currentTarget).get('reference');
    updateUrl({
      reference:
        typeof reference === 'string' ? reference.trim() || null : null,
      page: null,
    });
  }

  if (wallets.isPending) return <LoadingState label="Loading wallets" />;
  if (wallets.isError)
    return (
      <ErrorState
        title="Transactions could not be loaded"
        onRetry={() => {
          void wallets.refetch();
        }}
      />
    );
  if (!wallets.data?.length)
    return (
      <EmptyState
        title="No wallet yet"
        description="Create a wallet before viewing transaction history."
      />
    );

  return (
    <div className="space-y-5">
      <form
        aria-label="Transaction filters"
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4"
        onSubmit={submitFilters}
      >
        <label className="grid gap-1 text-sm font-medium">
          Wallet
          <select
            aria-label="Wallet"
            className="h-10 rounded-md border border-input bg-background px-3"
            value={activeWallet?.id ?? ''}
            onChange={(event) =>
              updateUrl({ walletId: event.target.value, page: null })
            }
          >
            {wallets.data.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.currency} wallet ••{wallet.id.slice(-4)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Reference
          <input
            key={filters.reference ?? ''}
            aria-label="Reference"
            name="reference"
            className="h-10 rounded-md border border-input bg-background px-3"
            maxLength={100}
            defaultValue={filters.reference ?? ''}
            placeholder="Search reference"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          From
          <input
            aria-label="From date"
            type="date"
            max={filters.to?.slice(0, 10)}
            className="h-10 rounded-md border border-input bg-background px-3"
            value={filters.from?.slice(0, 10) ?? ''}
            onChange={(event) =>
              updateUrl({ from: event.target.value || null, page: null })
            }
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          To
          <input
            aria-label="To date"
            type="date"
            min={filters.from?.slice(0, 10)}
            className="h-10 rounded-md border border-input bg-background px-3"
            value={filters.to?.slice(0, 10) ?? ''}
            onChange={(event) =>
              updateUrl({ to: event.target.value || null, page: null })
            }
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Status
          <select
            aria-label="Status"
            className="h-10 rounded-md border border-input bg-background px-3"
            value={filters.status ?? ''}
            onChange={(event) =>
              updateUrl({ status: event.target.value || null, page: null })
            }
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Direction
          <select
            aria-label="Direction"
            className="h-10 rounded-md border border-input bg-background px-3"
            value={filters.direction ?? ''}
            onChange={(event) =>
              updateUrl({ direction: event.target.value || null, page: null })
            }
          >
            <option value="">All directions</option>
            {DIRECTIONS.map((direction) => (
              <option key={direction}>{direction}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Date order
          <select
            aria-label="Date order"
            className="h-10 rounded-md border border-input bg-background px-3"
            value={filters.sort}
            onChange={(event) =>
              updateUrl({ sort: event.target.value, page: null })
            }
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            type="submit"
          >
            Search
          </button>
          <button
            className="h-10 rounded-md border border-border px-4 text-sm"
            type="reset"
            onClick={() => {
              window.setTimeout(
                () =>
                  updateUrl({
                    reference: null,
                    from: null,
                    to: null,
                    status: null,
                    direction: null,
                    sort: null,
                    page: null,
                  }),
                0,
              );
            }}
          >
            Clear
          </button>
        </div>
      </form>
      {history.isPending ? (
        <LoadingState label="Loading transaction history" />
      ) : history.isError ? (
        history.error instanceof ApiError && history.error.status === 403 ? (
          <ErrorState
            title="Transaction history is not available"
            description="Your account is not permitted to view this wallet’s transactions."
          />
        ) : (
          <ErrorState
            title="Transaction history could not be loaded"
            onRetry={() => {
              void history.refetch();
            }}
          />
        )
      ) : history.data?.data.length ? (
        <>
          {history.isFetching && (
            <p className="text-xs text-muted-foreground" role="status">
              Refreshing transaction history…
            </p>
          )}
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Direction / type</th>
                  <th className="px-4 py-3">Counterparty</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {history.data.data.map((row) => (
                  <tr className="border-t border-border" key={row.id}>
                    <td className="px-4 py-3">
                      {displayDate(row.postedAt ?? row.createdAt)}
                    </td>
                    <td
                      className="max-w-52 truncate px-4 py-3 font-mono text-xs"
                      title={reference(row)}
                    >
                      {reference(row)}
                    </td>
                    <td className="px-4 py-3">
                      {row.direction.toLowerCase()} ·{' '}
                      {row.type.replaceAll('_', ' ').toLowerCase()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.counterpartyWalletId
                        ? `••${row.counterpartyWalletId.slice(-4)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyDisplay amountMinor={row.amountMinor} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label={row.status} tone={tone(row.status)} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        href={`/transactions/${row.transactionId}${historyQuery ? `?${historyQuery}` : ''}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {history.data.data.map((row) => (
              <TransactionCard
                key={row.id}
                row={row}
                historyQuery={historyQuery}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-4">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {history.data.pagination.total} transaction
              {history.data.pagination.total === 1 ? '' : 's'} · page{' '}
              {history.data.pagination.page} of{' '}
              {Math.max(1, history.data.pagination.totalPages)}
            </p>
            <div className="flex gap-2">
              <button
                className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                disabled={page <= 1 || history.isFetching}
                onClick={() => updateUrl({ page: String(page - 1) })}
              >
                Previous
              </button>
              <button
                className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                disabled={
                  page >= history.data.pagination.totalPages ||
                  history.isFetching
                }
                onClick={() => updateUrl({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          title={
            filters.reference ||
            filters.from ||
            filters.to ||
            filters.status ||
            filters.direction
              ? 'No matching transactions'
              : 'No transactions yet'
          }
          description={
            filters.reference ||
            filters.from ||
            filters.to ||
            filters.status ||
            filters.direction
              ? 'Try changing or clearing your filters.'
              : 'Transactions for this wallet will appear here.'
          }
        />
      )}
    </div>
  );
}
