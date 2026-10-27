import { PlaceholderPage } from '@/components/placeholder-page';
import { requireRole } from '@/lib/auth/require-role';

export default async function TransactionsPage() {
  await requireRole('CUSTOMER');
  return <PlaceholderPage route="/transactions" />;
}
