import {
  Activity,
  ArrowLeftRight,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Palette,
  ScrollText,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@/lib/auth/types';

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  {
    label: 'Customer workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/wallets', label: 'Wallets', icon: Wallet },
      { href: '/transfer', label: 'Transfer', icon: ArrowLeftRight },
      { href: '/transactions', label: 'Transactions', icon: ClipboardList },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    label: 'Operations workspace',
    items: [
      { href: '/operations', label: 'Overview', icon: Gauge },
      {
        href: '/operations/transactions',
        label: 'Transactions',
        icon: ArrowLeftRight,
      },
      { href: '/operations/users', label: 'Users', icon: Users },
      { href: '/operations/jobs', label: 'Jobs', icon: ListChecks },
      { href: '/operations/audit', label: 'Audit', icon: ScrollText },
      {
        href: '/operations/reconciliation',
        label: 'Reconciliation',
        icon: Activity,
      },
    ],
  },
  ...(process.env.NODE_ENV === 'development'
    ? [
        {
          label: 'Development',
          items: [
            { href: '/design-system', label: 'Design system', icon: Palette },
          ],
        },
      ]
    : []),
];

export function navigationGroupsFor(role: UserRole) {
  return navigationGroups.filter((group) => {
    if (group.label === 'Development') return true;
    if (group.label === 'Customer workspace') return role === 'CUSTOMER';
    return role === 'ADMIN' || role === 'OPERATIONS';
  }).map((group) => ({
    ...group,
    items: role === 'OPERATIONS'
      ? group.items.filter((item) => item.href !== '/operations/users')
      : group.items,
  }));
}

export function currentNavigationItem(
  pathname: string,
  role: UserRole,
): NavigationItem | undefined {
  return navigationGroupsFor(role)
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];
}
