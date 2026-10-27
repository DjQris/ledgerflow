'use client';

import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, ArrowUpRight as Open, RefreshCw, Wallet as WalletIcon } from 'lucide-react';
import { Stat } from 'panelui-web/stat';
import { useMemo, useState } from 'react';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { MoneyDisplay } from '@/components/money-display';
import { PageHeader } from '@/components/page-header';
import { PageSection } from '@/components/page-section';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth/hooks';
import { ApiError } from '@/lib/auth/client';
import { useRecentTransactions, useWallets } from '@/lib/customer/hooks';
import type { WalletTransaction } from '@/lib/customer/wallet-types';

const EMPTY_WALLETS: [] = [];
const dateFormat = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function statusTone(status: string): StatusTone {
  switch (status.toUpperCase()) {
    case 'POSTED':
    case 'COMPLETED': return 'success';
    case 'PENDING':
    case 'PROCESSING': return 'warning';
    case 'FAILED':
    case 'REJECTED': return 'destructive';
    default: return 'neutral';
  }
}

function transactionTitle(transaction: WalletTransaction): string {
  if (transaction.counterpartyWalletId) {
    const suffix = transaction.counterpartyWalletId.slice(-4).toUpperCase();
    return `${transaction.direction === 'INCOMING' ? 'From' : 'To'} wallet ••${suffix}`;
  }
  return transaction.description?.slice(0, 80) || transaction.type.replaceAll('_', ' ').toLowerCase();
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const incoming = transaction.direction === 'INCOMING';
  const neutral = transaction.direction === 'NEUTRAL';
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const timestamp = transaction.postedAt ?? transaction.createdAt;
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] sm:gap-4">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted" aria-hidden="true">
        {neutral ? <WalletIcon className="size-4" /> : <Icon className="size-4" />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{transactionTitle(transaction)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{dateFormat.format(new Date(timestamp))}</p>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-3 sm:col-start-auto sm:block sm:text-right">
        <p className={`font-mono text-sm font-semibold tabular-nums ${incoming ? 'text-success' : ''}`}>
          <MoneyDisplay amountMinor={transaction.amountMinor} />
        </p>
        <span className="text-xs text-muted-foreground sm:hidden">{transaction.direction.toLowerCase()}</span>
      </div>
      <div className="col-start-2 sm:col-start-auto sm:justify-self-end">
        <StatusBadge label={transaction.status} tone={statusTone(transaction.status)} />
      </div>
    </li>
  );
}

export function CustomerDashboard() {
  const user = useCurrentUser();
  const wallets = useWallets();
  const walletList = wallets.data ?? EMPTY_WALLETS;
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>();
  const activeWallet = walletList.find((wallet) => wallet.id === selectedWalletId) ?? walletList[0];
  const history = useRecentTransactions(activeWallet?.id);
  const totalBalance = useMemo(
    () => walletList.reduce((total, wallet) => total + BigInt(wallet.balanceMinor), 0n).toString(),
    [walletList],
  );
  const refreshTime = wallets.dataUpdatedAt
    ? dateFormat.format(new Date(wallets.dataUpdatedAt))
    : null;
  const queryError = wallets.error ?? history.error;
  const authExpired = queryError instanceof ApiError && queryError.status === 401;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Customer workspace"
        title="Overview"
        description="Your wallet balances and latest posted activity."
        actions={(
          <Button type="button" variant="outline" onClick={() => { void wallets.refetch(); void history.refetch(); }} disabled={wallets.isFetching}>
            <RefreshCw className={`size-4 ${wallets.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        )}
      />

      {authExpired && <ErrorState title="Your session has expired" description="Please sign in again to view your wallet." />}

      {wallets.isPending ? <LoadingState label="Loading your wallets" /> : wallets.isError ? (
        <ErrorState title="Wallets could not be loaded" onRetry={() => { void wallets.refetch(); }} />
      ) : walletList.length === 0 ? (
        <DataPanel title="Your wallet" description="No wallet is associated with this account yet.">
          <EmptyState title="No wallet yet" description="When a wallet is created for your account, its balance and activity will appear here." />
        </DataPanel>
      ) : (
        <>
          <section aria-label="Wallet overview" className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
            <DataPanel title="Total available balance" description="Combined balance across your NGN wallets.">
              <div className="p-5 sm:p-6">
                <Stat>
                  <Stat.Content>
                    <Stat.Label>Available balance · NGN</Stat.Label>
                    <Stat.Value size="lg" className="mt-2">
                      <MoneyDisplay amountMinor={totalBalance} />
                    </Stat.Value>
                  </Stat.Content>
                </Stat>
                <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account owner</p>
                    <p className="mt-1 truncate text-sm font-medium">{user.data?.email ?? 'Signed-in customer'}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-muted-foreground">Last refreshed</p>
                    <p className="mt-1 text-sm font-medium">{refreshTime ?? 'Refreshing…'}</p>
                  </div>
                </div>
              </div>
            </DataPanel>

            <DataPanel title="Selected wallet" description="Wallet identifier and current status.">
              <div className="space-y-4 p-5 sm:p-6">
                {walletList.length > 1 && (
                  <label className="block space-y-2 text-sm font-medium" htmlFor="wallet-selector">
                    Choose wallet
                    <select
                      id="wallet-selector"
                      className="h-11 w-full rounded-md border border-input bg-background px-3 font-normal"
                      value={activeWallet?.id}
                      onChange={(event) => setSelectedWalletId(event.target.value)}
                    >
                      {walletList.map((wallet, index) => (
                        <option key={wallet.id} value={wallet.id}>Wallet {index + 1} · {wallet.id.slice(-4).toUpperCase()}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Wallet ID</p>
                    <p className="mt-1 break-all font-mono text-sm">{activeWallet?.id}</p>
                  </div>
                  <StatusBadge label={activeWallet?.status ?? 'Unknown'} tone={activeWallet?.status === 'ACTIVE' ? 'success' : 'neutral'} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {walletList.length} {walletList.length === 1 ? 'wallet' : 'wallets'} · NGN
                </p>
              </div>
            </DataPanel>
          </section>

          <PageSection title="Quick actions" description="Open a workspace to manage or review your wallet.">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { href: '/transfer', label: 'Make a transfer', detail: 'Send money between wallets', icon: ArrowUpRight },
                { href: '/transactions', label: 'View transactions', detail: 'Review your activity', icon: Open },
                { href: '/wallets', label: 'Wallet details', detail: 'View your wallets', icon: WalletIcon },
              ].map(({ href, label, detail, icon: Icon }) => (
                <Link key={href} href={href} className="group flex min-h-20 items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" aria-hidden="true" /></span>
                    <span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{detail}</span></span>
                  </span>
                  <Open className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </PageSection>

          <DataPanel
            title="Recent transactions"
            description={activeWallet ? `Latest posted activity for wallet ending ${activeWallet.id.slice(-4).toUpperCase()}.` : 'Latest wallet activity.'}
            action={<Button asChild variant="outline" size="sm"><Link href="/transactions">All transactions</Link></Button>}
          >
            {history.isPending ? <div className="p-5"><LoadingState label="Loading transactions" /></div> : history.isError ? (
              <div className="p-5"><ErrorState title="Transactions could not be loaded" onRetry={() => { void history.refetch(); }} /></div>
            ) : history.data?.data.length ? (
              <ul className="divide-y divide-border px-4 sm:px-5">
                {history.data.data.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} />)}
              </ul>
            ) : (
              <EmptyState title="No recent transactions" description="Posted transactions for this wallet will appear here." />
            )}
          </DataPanel>
        </>
      )}
    </div>
  );
}
