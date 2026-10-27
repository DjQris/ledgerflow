import { handleOperationsReconciliation } from '@/lib/operations/center-bff';

export const dynamic = 'force-dynamic';

export function GET() {
  return handleOperationsReconciliation();
}
