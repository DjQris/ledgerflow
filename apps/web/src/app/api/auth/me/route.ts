import { handleAuth } from '@/lib/auth/bff';

export const runtime = 'nodejs';
export async function GET(request: Request) { return handleAuth(request, 'me'); }
