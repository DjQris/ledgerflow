'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { AlertDialog } from 'panelui-web/alert-dialog';
import { Input } from 'panelui-web/input';
import { Label } from 'panelui-web/label';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { DataPanel } from '@/components/data-panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { MoneyDisplay } from '@/components/money-display';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth/hooks';
import { useCustomerTransfer, useWallets } from '@/lib/customer/hooks';
import {
  isCanonicalPositiveMinor,
  parseNgnToMinor,
} from '@/lib/customer/transfer-money';
import { TransferRequestError } from '@/lib/customer/transfer-client';
import type {
  CustomerTransferIntent,
  CustomerTransferResult,
} from '@/lib/customer/wallet-types';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const transferFormSchema = z.object({
  sourceWalletId: z.string().regex(uuidV4, 'Choose a source wallet.'),
  destinationWalletId: z
    .string()
    .regex(uuidV4, 'Enter a valid recipient wallet ID.'),
  amountNgn: z.string().refine((value) => {
    try {
      parseNgnToMinor(value);
      return true;
    } catch {
      return false;
    }
  }, 'Enter a positive NGN amount with at most two decimal places.'),
});
type TransferFields = z.infer<typeof transferFormSchema>;
type View =
  'restore' | 'editing' | 'reviewing' | 'submitting' | 'unknown' | 'success';

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function storageKey(userId: string) {
  return `ledgerflow-transfer-pending:${userId}`;
}

function readPending(
  value: string | null,
  ownerUserId: string,
): CustomerTransferIntent | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const intent = parsed as Record<string, unknown>;
    if (
      intent.ownerUserId !== ownerUserId ||
      typeof intent.sourceWalletId !== 'string' ||
      !uuidV4.test(intent.sourceWalletId) ||
      typeof intent.destinationWalletId !== 'string' ||
      !uuidV4.test(intent.destinationWalletId) ||
      intent.sourceWalletId.toLowerCase() ===
        intent.destinationWalletId.toLowerCase() ||
      typeof intent.amountNgn !== 'string' ||
      typeof intent.amountMinor !== 'string' ||
      typeof intent.idempotencyKey !== 'string' ||
      !uuidV4.test(intent.idempotencyKey) ||
      typeof intent.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(intent.createdAt))
    )
      return null;
    if (
      !isCanonicalPositiveMinor(intent.amountMinor) ||
      parseNgnToMinor(intent.amountNgn) !== intent.amountMinor
    )
      return null;
    return intent as unknown as CustomerTransferIntent;
  } catch {
    return null;
  }
}

export function TransferForm() {
  const user = useCurrentUser();
  const wallets = useWallets();
  const transfer = useCustomerTransfer();
  const [view, setView] = useState<View>('restore');
  const [intent, setIntent] = useState<CustomerTransferIntent | null>(null);
  const [result, setResult] = useState<CustomerTransferResult | null>(null);
  const [outcomeMessage, setOutcomeMessage] = useState('');
  const [intentStored, setIntentStored] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const activeWallets = useMemo(
    () => (wallets.data ?? []).filter((wallet) => wallet.status === 'ACTIVE'),
    [wallets.data],
  );
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TransferFields>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      sourceWalletId: '',
      destinationWalletId: '',
      amountNgn: '',
    },
  });
  const sourceWalletId = useWatch({ control, name: 'sourceWalletId' });
  const sourceWallet = activeWallets.find(
    (wallet) => wallet.id === sourceWalletId,
  );

  useEffect(() => {
    const ownerUserId = user.data?.id;
    if (!ownerUserId) return;
    const timer = window.setTimeout(() => {
      let pending: CustomerTransferIntent | null = null;
      try {
        pending = readPending(
          window.sessionStorage.getItem(storageKey(ownerUserId)),
          ownerUserId,
        );
      } catch {
        // Storage can be unavailable; this does not prevent a transfer, only refresh recovery.
      }
      if (pending) {
        setIntent(pending);
        setIntentStored(true);
        setOutcomeMessage(
          'A previous transfer attempt has an unknown outcome. Retry the same request key to verify it safely.',
        );
        setView('unknown');
      } else {
        setView('editing');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [user.data?.id]);

  useEffect(() => {
    if (view !== 'editing' || sourceWalletId || activeWallets.length === 0)
      return;
    setValue('sourceWalletId', activeWallets[0].id, { shouldValidate: false });
  }, [activeWallets, setValue, sourceWalletId, view]);

  function removePending() {
    try {
      if (user.data?.id)
        window.sessionStorage.removeItem(storageKey(user.data.id));
    } catch {
      // Ignore storage failures; no credentials are stored here.
    }
  }

  function savePending(value: CustomerTransferIntent) {
    try {
      window.sessionStorage.setItem(
        storageKey(value.ownerUserId),
        JSON.stringify(value),
      );
      setIntentStored(true);
    } catch {
      // The in-memory key remains available for retries during this page session.
      setIntentStored(false);
    }
  }

  async function submitIntent(value: CustomerTransferIntent) {
    savePending(value);
    setOutcomeMessage('');
    setView('submitting');
    try {
      const completed = await transfer.mutateAsync(value);
      removePending();
      setResult(completed);
      setIntent(null);
      setView('success');
    } catch (error) {
      const failure =
        error instanceof TransferRequestError
          ? error
          : new TransferRequestError(
              'The transfer outcome could not be confirmed. Verify this same transfer safely.',
              'unknown',
              'TRANSFER_OUTCOME_UNKNOWN',
              503,
            );
      setOutcomeMessage(failure.message);
      if (failure.outcome === 'unknown') {
        setIntent(value);
        savePending(value);
        setView('unknown');
      } else {
        removePending();
        setIntent(null);
        setError('root', { message: failure.message });
        setView('editing');
      }
    }
  }

  const review = handleSubmit((fields) => {
    clearErrors('root');
    const selectedWallet = activeWallets.find(
      (wallet) => wallet.id === fields.sourceWalletId,
    );
    if (!selectedWallet) {
      setError('sourceWalletId', {
        message: 'Choose an active source wallet.',
      });
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parseNgnToMinor(fields.amountNgn);
    } catch (error) {
      setError('amountNgn', {
        message:
          error instanceof Error ? error.message : 'Enter a valid NGN amount.',
      });
      return;
    }
    if (
      fields.sourceWalletId.toLowerCase() ===
      fields.destinationWalletId.toLowerCase()
    ) {
      setError('destinationWalletId', {
        message: 'Choose a recipient wallet different from the source.',
      });
      return;
    }
    if (BigInt(amountMinor) > BigInt(selectedWallet.balanceMinor)) {
      setError('amountNgn', {
        message:
          'Amount is greater than the selected wallet’s available balance.',
      });
      return;
    }
    if (!user.data?.id || typeof crypto.randomUUID !== 'function') {
      setError('root', {
        message:
          'A secure transfer key could not be generated. Reload the page and try again.',
      });
      return;
    }
    setIntent({
      ownerUserId: user.data.id,
      sourceWalletId: selectedWallet.id,
      destinationWalletId: fields.destinationWalletId.toLowerCase(),
      amountMinor,
      amountNgn: fields.amountNgn,
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    setView('reviewing');
  });

  if (view === 'restore' || wallets.isPending)
    return <LoadingState label="Loading transfer details" />;
  if (wallets.isError)
    return (
      <ErrorState
        title="Wallets could not be loaded"
        description="Transfer details are unavailable until your wallet list loads."
        onRetry={() => {
          void wallets.refetch();
        }}
      />
    );

  if (view === 'success' && result) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Transfer complete"
          title="Transfer successful"
          description="The backend confirmed this wallet transfer."
        />
        <DataPanel
          title="Transfer receipt"
          description="Confirmed result from LedgerFlow."
        >
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2
                className="size-6 text-success"
                aria-hidden="true"
              />
              <StatusBadge label={result.status} tone="success" />
            </div>
            <p className="font-mono text-3xl font-semibold">
              <MoneyDisplay amountMinor={result.amountMinor} />
            </p>
            <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Recipient wallet
                </dt>
                <dd className="mt-1 break-all font-mono text-sm">
                  {result.destinationWalletId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source wallet</dt>
                <dd className="mt-1 break-all font-mono text-sm">
                  {result.sourceWalletId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Transfer reference
                </dt>
                <dd className="mt-1 break-all font-mono text-sm">
                  {result.transferId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Completed</dt>
                <dd className="mt-1 text-sm">
                  {dateFormat.format(new Date(result.completedAt))}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-3 border-t border-border pt-4">
              <Button asChild>
                <Link
                  href={`/transactions/${encodeURIComponent(result.journalId)}?walletId=${encodeURIComponent(result.sourceWalletId)}`}
                >
                  View transaction details
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setView('editing');
                }}
              >
                Make another transfer
              </Button>
            </div>
          </div>
        </DataPanel>
      </div>
    );
  }

  if (view === 'unknown' && intent) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Transfer verification"
          title="Outcome not confirmed"
          description="Do not create another transfer for this payment. Verify or safely retry this exact request."
        />
        <DataPanel
          title="Pending transfer intent"
          description="The same idempotency key and payload will be reused for verification."
        >
          <div className="space-y-5 p-5 sm:p-6">
            <div
              role="alert"
              className="flex gap-3 rounded-lg border border-warning bg-warning/10 p-4 text-sm"
            >
              <CircleAlert
                className="mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
              <p>{outcomeMessage}</p>
            </div>
            {!intentStored && (
              <p
                role="status"
                className="rounded-md border border-warning p-3 text-sm"
              >
                This browser could not save the verification details. Keep this
                tab open until the transfer outcome is confirmed.
              </p>
            )}
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="mt-1 text-lg font-semibold">
                  <MoneyDisplay amountMinor={intent.amountMinor} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Recipient wallet
                </dt>
                <dd className="mt-1 break-all font-mono text-sm">
                  {intent.destinationWalletId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source wallet</dt>
                <dd className="mt-1 break-all font-mono text-sm">
                  {intent.sourceWalletId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Started</dt>
                <dd className="mt-1 text-sm">
                  {dateFormat.format(new Date(intent.createdAt))}
                </dd>
              </div>
            </dl>
            <Button
              type="button"
              disabled={transfer.isPending}
              onClick={() => {
                void submitIntent(intent);
              }}
            >
              {transfer.isPending ? (
                <>
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />{' '}
                  Verifying…
                </>
              ) : (
                'Verify / retry this transfer safely'
              )}
            </Button>
          </div>
        </DataPanel>
      </div>
    );
  }

  const activeViewWallets = activeWallets;
  if (activeViewWallets.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Customer workspace"
          title="Transfer"
          description="Send simulated NGN funds to another wallet."
        />
        <DataPanel
          title="No active source wallet"
          description="An active NGN wallet is required to start a transfer."
        >
          <EmptyState
            title="No active wallet"
            description="This account has no active source wallet. No transfer can be submitted."
          />
        </DataPanel>
      </>
    );
  }

  const currentForm = (
    <form onSubmit={review} noValidate className="space-y-5 p-5 sm:p-6">
      <div className="space-y-2">
        <Label
          htmlFor="sourceWalletId"
          required
          invalid={Boolean(errors.sourceWalletId)}
        >
          From wallet
        </Label>
        <select
          id="sourceWalletId"
          {...register('sourceWalletId')}
          aria-invalid={Boolean(errors.sourceWalletId)}
          aria-describedby={
            errors.sourceWalletId
              ? 'sourceWalletId-error'
              : 'sourceWalletId-balance'
          }
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {activeViewWallets.map((wallet, index) => (
            <option key={wallet.id} value={wallet.id}>
              Wallet {index + 1} · {wallet.id.slice(-4).toUpperCase()}
            </option>
          ))}
        </select>
        {errors.sourceWalletId ? (
          <p
            id="sourceWalletId-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.sourceWalletId.message}
          </p>
        ) : (
          sourceWallet && (
            <p
              id="sourceWalletId-balance"
              className="text-sm text-muted-foreground"
            >
              Available:{' '}
              <MoneyDisplay amountMinor={sourceWallet.balanceMinor} />
            </p>
          )
        )}
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="destinationWalletId"
          required
          invalid={Boolean(errors.destinationWalletId)}
        >
          Recipient wallet ID
        </Label>
        <Input
          id="destinationWalletId"
          autoComplete="off"
          placeholder="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
          aria-invalid={Boolean(errors.destinationWalletId)}
          aria-describedby={
            errors.destinationWalletId ? 'destinationWalletId-error' : undefined
          }
          {...register('destinationWalletId')}
        />
        {errors.destinationWalletId && (
          <p
            id="destinationWalletId-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.destinationWalletId.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="amountNgn" required invalid={Boolean(errors.amountNgn)}>
          Amount
        </Label>
        <Input
          id="amountNgn"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          aria-invalid={Boolean(errors.amountNgn)}
          aria-describedby={
            errors.amountNgn ? 'amountNgn-error' : 'amountNgn-hint'
          }
          {...register('amountNgn')}
        />
        <p id="amountNgn-hint" className="text-xs text-muted-foreground">
          NGN · enter up to two decimal places, e.g. 1000.50
        </p>
        {errors.amountNgn && (
          <p
            id="amountNgn-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.amountNgn.message}
          </p>
        )}
      </div>

      {errors.root && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {errors.root.message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" />
          The backend verifies ownership and final balance.
        </p>
        <Button type="submit" disabled={isSubmitting}>
          Review transfer
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer workspace"
        title="Transfer"
        description="Send simulated NGN funds between LedgerFlow wallets. Review the details before confirming."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <DataPanel
          title={view === 'reviewing' ? 'Review transfer' : 'New transfer'}
          description="Transfers are processed securely by LedgerFlow’s backend."
        >
          {view === 'reviewing' && intent ? (
            <div className="space-y-5 p-5 sm:p-6">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">From wallet</dt>
                  <dd className="mt-1 break-all font-mono text-sm">
                    {intent.sourceWalletId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Recipient wallet
                  </dt>
                  <dd className="mt-1 break-all font-mono text-sm">
                    {intent.destinationWalletId}
                  </dd>
                </div>
              </dl>
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">Amount to send</p>
                <p className="mt-1 text-2xl font-semibold">
                  <MoneyDisplay amountMinor={intent.amountMinor} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">NGN</p>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIntent(null);
                    setView('editing');
                  }}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Edit details
                </Button>
                <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <AlertDialog.Trigger
                    render={
                      <Button type="button" disabled={transfer.isPending}>
                        Confirm transfer
                      </Button>
                    }
                  />
                  <AlertDialog.Content size="sm" tone="warning">
                    <AlertDialog.Title>Send this transfer?</AlertDialog.Title>
                    <AlertDialog.Description>
                      Confirm <MoneyDisplay amountMinor={intent.amountMinor} />{' '}
                      to wallet ending{' '}
                      {intent.destinationWalletId.slice(-4).toUpperCase()}. Your
                      available balance will change only after backend
                      confirmation.
                    </AlertDialog.Description>
                    <AlertDialog.Footer>
                      <AlertDialog.Cancel disabled={transfer.isPending}>
                        Cancel
                      </AlertDialog.Cancel>
                      <AlertDialog.Action
                        loading={transfer.isPending}
                        disabled={transfer.isPending}
                        onClick={async (event) => {
                          event.preventDefault();
                          await submitIntent(intent);
                        }}
                      >
                        Send transfer
                      </AlertDialog.Action>
                    </AlertDialog.Footer>
                  </AlertDialog.Content>
                </AlertDialog>
              </div>
            </div>
          ) : view === 'submitting' ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 p-6"
            >
              <LoaderCircle
                className="size-5 animate-spin"
                aria-hidden="true"
              />
              <p className="text-sm">
                Submitting securely. Keep this page open while the result is
                confirmed.
              </p>
            </div>
          ) : (
            currentForm
          )}
        </DataPanel>
        <aside className="space-y-4">
          <DataPanel
            title="Transfer safety"
            description="What happens when you send."
          >
            <ul className="space-y-3 p-5 text-sm text-muted-foreground sm:p-6">
              <li>
                LedgerFlow verifies the source wallet belongs to you and checks
                the final balance.
              </li>
              <li>
                Amounts are converted to kobo exactly; no floating-point
                arithmetic is used.
              </li>
              <li>
                Each request has an idempotency key to prevent accidental
                duplicate transfers.
              </li>
            </ul>
          </DataPanel>
          {sourceWallet && (
            <DataPanel
              title="Available balance"
              description="Current backend-reported balance of the selected source wallet."
            >
              <div className="p-5">
                <p className="text-2xl font-semibold">
                  <MoneyDisplay amountMinor={sourceWallet.balanceMinor} />
                </p>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                  {sourceWallet.id}
                </p>
              </div>
            </DataPanel>
          )}
        </aside>
      </div>
    </div>
  );
}
