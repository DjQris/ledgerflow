import { CustomerDashboard } from './customer-dashboard';
import { requireRole } from '@/lib/auth/require-role';

export default async function DashboardPage() {
  await requireRole('CUSTOMER');
  return <CustomerDashboard />;
}
