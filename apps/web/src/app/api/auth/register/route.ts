import { handleAuth } from '@/lib/auth/bff';

export const runtime = 'nodejs';
export async function POST(request: Request) { return handleAuth(request, 'register'); }
