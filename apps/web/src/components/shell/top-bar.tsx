import { Moon, Sun } from 'lucide-react';

import { useTheme } from '@/components/theme-provider';
import type { UserProfile } from '@/lib/auth/types';

import { MobileNavigation } from './mobile-navigation';
import { currentNavigationItem } from './navigation';
import { UserMenu } from './user-menu';

export function TopBar({ pathname, user }: { pathname: string; user: UserProfile }) {
  const { theme, toggleTheme } = useTheme();
  const current = currentNavigationItem(pathname, user.role);
  const workspace =
    pathname === '/design-system'
      ? 'Development'
      : pathname.startsWith('/operations')
        ? 'Operations'
        : 'Customer';

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="relative flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNavigation pathname={pathname} role={user.role} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{workspace} workspace</p>
          <p className="truncate text-sm font-semibold">
            {current?.label ?? 'LedgerFlow'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="flex size-[var(--touch-target)] items-center justify-center rounded-lg border border-border hover:bg-accent"
        >
          {theme === 'dark' ? (
            <Sun className="size-4" aria-hidden="true" />
          ) : (
            <Moon className="size-4" aria-hidden="true" />
          )}
        </button>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
