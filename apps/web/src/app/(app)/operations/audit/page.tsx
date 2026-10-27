import { Suspense } from 'react';

import { LoadingState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth/require-role';
import { OperationsAudit } from './operations-audit';

export default async function OperationsAuditPage() {
  await requireRole('OPERATIONS', 'ADMIN');
  return <div className="space-y-6"><PageHeader title="Audit events" description="Search and review read-only audit records for transactions, authentication, administration, and recovery. Context is allowlisted by event type." /><Suspense fallback={<LoadingState label="Loading audit events" />}><OperationsAudit /></Suspense></div>;
}
