import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { currentSession, hasRefreshCookie } from './backend';
import type { UserRole } from './types';

export async function requireRole(...roles: UserRole[]): Promise<void> {
  const session = await currentSession();
  if (session.status === 401) {
    redirect((await hasRefreshCookie()) ? '/session/renew' : '/login');
  }
  if (!session.profile) throw new Error('Authentication service unavailable');
  if (!roles.includes(session.profile.role)) notFound();
}
