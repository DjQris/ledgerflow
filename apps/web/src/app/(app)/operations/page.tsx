import { Suspense } from 'react';

import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth/require-role';

import { OperationsDashboard } from './operations-dashboard';

export default async function OperationsPage() {
  await requireRole('OPERATIONS', 'ADMIN');
  return (
    <div className="space-y-6">
      <PageHeader title="Operations overview" description="Verified transfer, account, queue, and audit activity." />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading operational data…</p>}>
        <OperationsDashboard />
      </Suspense>
    </div>
  );
}
