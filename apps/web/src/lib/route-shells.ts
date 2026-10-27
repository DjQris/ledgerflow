export type RouteShell = {
  title: string;
  description: string;
  workspace: 'Customer' | 'Operations';
  columns?: readonly string[];
  metric?: string;
};

export const routeShells = {
  '/dashboard': {
    title: 'Overview',
    description: 'A future home for wallet activity and transfer summaries.',
    workspace: 'Customer',
    metric: 'Available balance',
  },
  '/wallets': {
    title: 'Wallets',
    description:
      'Wallet balances and details will appear here after account integration.',
    workspace: 'Customer',
    metric: 'Wallet balance',
  },
  '/transfer': {
    title: 'Transfer',
    description: 'Review and submit a secure wallet-to-wallet transfer.',
    workspace: 'Customer',
  },
  '/transactions': {
    title: 'Transactions',
    description: 'A responsive transaction-history shell without live records.',
    workspace: 'Customer',
    columns: ['Date', 'Reference', 'Amount', 'Status'],
  },
  '/settings': {
    title: 'Settings',
    description:
      'Account preferences will be available after authentication is integrated.',
    workspace: 'Customer',
  },
  '/operations': {
    title: 'Operations overview',
    description:
      'A future command center for staff monitoring and investigation.',
    workspace: 'Operations',
    metric: 'Jobs requiring review',
  },
  '/operations/transactions': {
    title: 'Transaction review',
    description: 'A table shell for authorized transaction investigations.',
    workspace: 'Operations',
    columns: ['Reference', 'Customer', 'Amount', 'Status', 'Updated'],
  },
  '/operations/users': {
    title: 'User administration',
    description: 'A table shell for authorized user management.',
    workspace: 'Operations',
    columns: ['User', 'Role', 'Status', 'Updated'],
  },
  '/operations/jobs': {
    title: 'Background jobs',
    description: 'A table shell for failed-job review and safe recovery.',
    workspace: 'Operations',
    columns: ['Job', 'Source', 'Reason', 'Status', 'Updated'],
  },
  '/operations/audit': {
    title: 'Audit trail',
    description: 'A table shell for authorized audit-event review.',
    workspace: 'Operations',
    columns: ['Time', 'Actor', 'Action', 'Outcome'],
  },
  '/operations/reconciliation': {
    title: 'Reconciliation',
    description: 'A future surface for ledger and background-delivery checks.',
    workspace: 'Operations',
    columns: ['Check', 'Scope', 'Result', 'Updated'],
  },
} as const satisfies Record<string, RouteShell>;

export type RouteShellPath = keyof typeof routeShells;
