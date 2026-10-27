import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth/require-role';
import { notFound } from 'next/navigation';

import { TransactionDetails } from './transaction-details';

export default async function TransactionDetailsPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  await requireRole('CUSTOMER');
  const { transactionId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      transactionId,
    )
  )
    notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction details"
        description="A customer-safe view of this transaction."
      />
      <TransactionDetails transactionId={transactionId} />
    </div>
  );
}
