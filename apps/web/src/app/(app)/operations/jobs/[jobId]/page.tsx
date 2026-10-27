import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth/require-role';

import { OperationsJobDetail } from './job-detail';

export default async function OperationsJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  await requireRole('OPERATIONS', 'ADMIN');
  const { jobId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) notFound();
  return <div className="space-y-6"><PageHeader title="Background job details" description="Safe failure context and current event-processing state from PostgreSQL-backed records." /><OperationsJobDetail id={jobId} /></div>;
}
