import { TransferForm } from './transfer-form';
import { requireRole } from '@/lib/auth/require-role';

export default async function TransferPage() {
  await requireRole('CUSTOMER');
  return <TransferForm />;
}
