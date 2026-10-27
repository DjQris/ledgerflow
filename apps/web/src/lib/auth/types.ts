export type UserRole = 'CUSTOMER' | 'OPERATIONS' | 'ADMIN';
export type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
};

export const authKeys = { me: ['auth', 'me'] as const };

export function safeNextPath(value: string | undefined, role: UserRole): string {
  const allowed = role === 'CUSTOMER'
    ? ['/dashboard', '/wallets', '/transfer', '/transactions', '/settings']
    : role === 'ADMIN'
      ? ['/dashboard', '/operations', '/operations/transactions', '/operations/users', '/operations/jobs', '/operations/audit', '/operations/reconciliation', '/settings']
      : ['/dashboard', '/operations', '/operations/transactions', '/operations/jobs', '/operations/audit', '/operations/reconciliation', '/settings'];
  return value && allowed.includes(value) ? value : '/dashboard';
}
