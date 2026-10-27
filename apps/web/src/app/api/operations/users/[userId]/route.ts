import { handleAdminUser } from '@/lib/operations/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  return handleAdminUser(userId);
}
