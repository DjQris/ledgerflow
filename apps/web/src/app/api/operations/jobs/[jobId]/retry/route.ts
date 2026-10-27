import { handleOperationsRetry } from '@/lib/operations/center-bff';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return handleOperationsRetry(request, jobId);
}
