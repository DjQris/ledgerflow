import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { currentSession, hasRefreshCookie } from '@/lib/auth/backend';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (session.status === 401) {
    redirect((await hasRefreshCookie()) ? '/session/renew' : '/login');
  }
  if (!session.profile) throw new Error('Authentication service unavailable');
  return <AppShell user={session.profile}>{children}</AppShell>;
}
