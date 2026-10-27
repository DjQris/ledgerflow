import { PlaceholderPage } from '@/components/placeholder-page';
import { requireRole } from '@/lib/auth/require-role';

export default async function WalletsPage() {
  await requireRole('CUSTOMER');
  return <PlaceholderPage route="/wallets" />;
}
