import { handleCustomerTransfer } from '@/lib/customer/transfer-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleCustomerTransfer(request);
}
