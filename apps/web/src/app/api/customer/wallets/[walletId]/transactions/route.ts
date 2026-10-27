import { handleCustomerTransactions } from '@/lib/customer/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ walletId: string }> },
) {
  const { walletId } = await context.params;
  return handleCustomerTransactions(request, walletId);
}
