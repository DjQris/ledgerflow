'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/auth/client';
import { useCurrentUser } from '@/lib/auth/hooks';
import type { UserProfile } from '@/lib/auth/types';

import { SidebarNavigation } from './sidebar-navigation';
import { TopBar } from './top-bar';

export function AppShell({
  children,
  user: initialUser,
}: {
  children: ReactNode;
  user: UserProfile;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useCurrentUser(initialUser);
  const user = session.data ?? initialUser;
  const sessionRejected =
    session.error instanceof ApiError && session.error.status === 401;

  useEffect(() => {
    if (sessionRejected) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'auth',
      });
      router.replace('/login');
      router.refresh();
    }
  }, [queryClient, router, sessionRejected]);

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:p-3"
      >
        Skip to main content
      </a>
      <SidebarNavigation pathname={pathname} role={user.role} />
      <div className="min-w-0">
        <TopBar pathname={pathname} user={user} />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[var(--content-max)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {sessionRejected ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-destructive p-3 text-sm"
            >
              Your session has expired. Sign in again to continue.
            </p>
          ) : (
            session.isError && (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-destructive p-3 text-sm"
              >
                Session check failed. Please retry in a moment.
              </p>
            )
          )}
          {!sessionRejected && children}
        </main>
      </div>
    </div>
  );
}
