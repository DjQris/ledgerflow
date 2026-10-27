import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { currentSession } from '@/lib/auth/backend';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const session = await currentSession();
  if (session.profile) redirect('/dashboard');
  return <AuthForm mode="register" />;
}
