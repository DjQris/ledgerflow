import type { ReactNode } from 'react';

import { requireRole } from '@/lib/auth/require-role';

export default async function OperationsLayout({ children }: { children: ReactNode }) {
  await requireRole('OPERATIONS', 'ADMIN');
  return children;
}
