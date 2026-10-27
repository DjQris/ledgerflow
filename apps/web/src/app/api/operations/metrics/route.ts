import { handleOperationsMetrics } from '@/lib/operations/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleOperationsMetrics(request);
}
