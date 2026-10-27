import Link from 'next/link';
import { Landmark } from 'lucide-react';

import { NavLinks } from './nav-links';
import type { UserRole } from '@/lib/auth/types';

export function SidebarNavigation({ pathname, role }: { pathname: string; role: UserRole }) {
  return (
    <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-border bg-surface-sunken px-3 py-5 lg:flex">
      <Link
        href="/dashboard"
        className="flex min-h-[var(--touch-target)] items-center gap-3 px-3 font-semibold tracking-tight"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Landmark className="size-4" aria-hidden="true" />
        </span>
        LedgerFlow
      </Link>
      <nav aria-label="Primary" className="mt-9 flex-1">
        <NavLinks pathname={pathname} role={role} />
      </nav>
      <p className="border-t border-border px-3 pt-4 text-xs text-muted-foreground">
        Signed-in workspace · financial views remain previews
      </p>
    </aside>
  );
}
