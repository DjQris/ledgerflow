import { handleOperationsAudit } from '@/lib/operations/center-bff';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleOperationsAudit(request);
}
