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

export function currentNavigationItem(
  pathname: string,
): NavigationItem | undefined {
  return navigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.href === pathname);
}
