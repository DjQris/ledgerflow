import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth/require-role';
import { Suspense } from 'react';

import { TransactionHistory } from './transaction-history';

export default async function TransactionsPage() {
  await requireRole('CUSTOMER');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Search and review activity across your wallets."
      />
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">
            Loading transaction history…
          </p>
        }
      >
        <TransactionHistory />
      </Suspense>
    </div>
  );
}
