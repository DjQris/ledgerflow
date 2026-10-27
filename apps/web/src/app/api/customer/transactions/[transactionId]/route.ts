import { handleCustomerTransactionDetails } from '@/lib/customer/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ transactionId: string }> },
) {
  const { transactionId } = await context.params;
  return handleCustomerTransactionDetails(transactionId);
}
