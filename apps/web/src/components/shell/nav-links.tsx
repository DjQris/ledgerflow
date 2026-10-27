import Link from 'next/link';

import { cn } from '@/lib/utils';

import { navigationGroupsFor } from './navigation';
import type { UserRole } from '@/lib/auth/types';

export function NavLinks({
  pathname,
  role,
  onNavigate,
}: {
  pathname: string;
  role: UserRole;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-6">
      {navigationGroupsFor(role).map((group) => (
        <div key={group.label}>
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          <ul className="mt-2 space-y-1">
            {group.items.map(({ href, label, icon: Icon }) => {
              const current = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[var(--touch-target)] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      current
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
