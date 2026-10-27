import { handleOperationsJob } from '@/lib/operations/center-bff';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return handleOperationsJob(jobId);
}
