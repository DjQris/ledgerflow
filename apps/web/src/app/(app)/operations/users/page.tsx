import { PlaceholderPage } from '@/components/placeholder-page';
import { requireRole } from '@/lib/auth/require-role';

export default async function OperationsUsersPage() {
  await requireRole('ADMIN');
  return <PlaceholderPage route="/operations/users" />;
}
