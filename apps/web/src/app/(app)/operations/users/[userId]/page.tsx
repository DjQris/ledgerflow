import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { currentSession } from '@/lib/auth/backend';
import { requireRole } from '@/lib/auth/require-role';

import { AdminUserDetails } from './user-details';

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireRole('ADMIN');
  const { userId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) notFound();
  const session = await currentSession();
  if (!session.profile || session.profile.role !== 'ADMIN') notFound();
  return (
    <div className="space-y-6">
      <PageHeader title="User account" description="Review safe identity details and apply permitted account changes." />
      <AdminUserDetails userId={userId} actorId={session.profile.id} actor={session.profile} />
    </div>
  );
}
