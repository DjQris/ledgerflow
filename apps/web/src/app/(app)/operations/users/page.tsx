import { requireRole } from '@/lib/auth/require-role';

import { PageHeader } from '@/components/page-header';
import { AdminUsersTable } from './users-table';

export default async function OperationsUsersPage() {
  await requireRole('ADMIN');
  return (
    <div className="space-y-6">
      <PageHeader title="User management" description="Search user accounts and review access status. Administrative actions are audited and confirmed." />
      <AdminUsersTable />
    </div>
  );
}
