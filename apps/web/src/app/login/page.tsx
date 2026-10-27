import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { currentSession } from '@/lib/auth/backend';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; registered?: string }> }) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (session.profile) redirect('/dashboard');
  return <AuthForm mode="login" next={params.next}
    notice={params.registered === '1' ? 'Account created. Please sign in.' : undefined} />;
}
