import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth/require-role';
import { ReconciliationReport } from './reconciliation-report';

export default async function OperationsReconciliationPage() {
  await requireRole('OPERATIONS', 'ADMIN');
  return <div className="space-y-6"><PageHeader title="Ledger reconciliation" description="Run the backend’s read-only ledger integrity verification. This checks internal journal balance and wallet projections; it does not compare external settlement data or repair entries." /><ReconciliationReport /></div>;
}
