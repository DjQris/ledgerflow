'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { SidebarNavigation } from './sidebar-navigation';
import { TopBar } from './top-bar';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:p-3"
      >
        Skip to main content
      </a>
      <SidebarNavigation pathname={pathname} />
      <div className="min-w-0">
        <TopBar pathname={pathname} />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[var(--content-max)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
