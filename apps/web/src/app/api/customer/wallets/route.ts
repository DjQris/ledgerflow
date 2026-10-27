import { handleCustomerWallets } from '@/lib/customer/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return handleCustomerWallets(); }
