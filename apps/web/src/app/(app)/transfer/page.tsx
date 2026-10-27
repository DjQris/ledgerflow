import { PlaceholderPage } from '@/components/placeholder-page';
import { requireRole } from '@/lib/auth/require-role';

export default async function TransferPage() {
  await requireRole('CUSTOMER');
  return <PlaceholderPage route="/transfer" />;
}
