import { handleAdminUserMutation } from '@/lib/operations/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  return handleAdminUserMutation(request, userId, 'role');
}
