'use client';

import { ChevronDown, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useLogout } from '@/lib/auth/hooks';
import type { UserProfile } from '@/lib/auth/types';

export function UserMenu({ user }: { user: UserProfile }) {
  const router = useRouter();
  const logout = useLogout();
  const [error, setError] = useState(false);

  async function signOut() {
    setError(false);
    try {
      await logout.mutateAsync();
      router.replace('/login');
      router.refresh();
    } catch {
      setError(true);
    }
  }

  return (
    <details className="relative">
      <summary className="flex min-h-[var(--touch-target)] cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <UserRound className="size-4" aria-hidden="true" />
        <span className="hidden max-w-40 truncate sm:inline">{user.email}</span>
        <ChevronDown className="hidden size-3 sm:inline" aria-hidden="true" />
        <span className="sr-only sm:hidden">Account menu</span>
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-border bg-card p-3 text-sm text-card-foreground">
        <p className="break-all font-medium">{user.email}</p>
        <p className="mt-1 text-muted-foreground">{user.role.toLowerCase()} account</p>
        <button type="button" disabled={logout.isPending} onClick={signOut}
          className="mt-3 min-h-[var(--touch-target)] w-full rounded-md border border-border text-left px-3 hover:bg-accent disabled:opacity-50">
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </button>
        {error && <p role="alert" className="mt-2 text-destructive">Sign out failed. Try again.</p>}
      </div>
    </details>
  );
}
