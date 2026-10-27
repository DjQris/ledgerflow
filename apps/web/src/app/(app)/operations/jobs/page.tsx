import { Suspense } from 'react';

import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states';
import { requireRole } from '@/lib/auth/require-role';

import { OperationsJobsList } from './jobs-list';

export default async function OperationsJobsPage() {
  await requireRole('OPERATIONS', 'ADMIN');
  return <div className="space-y-6"><PageHeader title="Background jobs" description="Inspect failed notification and event-processing work. Retry eligibility is checked by the protected API; financial transfers are never replayed here." /><Suspense fallback={<LoadingState label="Loading background jobs" />}><OperationsJobsList /></Suspense></div>;
}
