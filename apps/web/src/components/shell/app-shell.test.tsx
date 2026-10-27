import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/auth/client';
import { useCurrentUser } from '@/lib/auth/hooks';
import type { UserProfile } from '@/lib/auth/types';

const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace, refresh }),
}));
vi.mock('@/lib/auth/hooks', () => ({ useCurrentUser: vi.fn() }));
vi.mock('./sidebar-navigation', () => ({ SidebarNavigation: () => null }));
vi.mock('./top-bar', () => ({ TopBar: () => null }));

import { AppShell } from './app-shell';

const customer: UserProfile = {
  id: 'customer-1',
  email: 'customer@example.test',
  role: 'CUSTOMER',
  status: 'ACTIVE',
};

describe('application shell on session expiry', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    vi.mocked(useCurrentUser).mockReturnValue({
      data: customer,
      error: new ApiError(401, 'Session expired'),
      isError: true,
    } as unknown as ReturnType<typeof useCurrentUser>);
  });

  it('hides protected children and clears cached user data before redirecting', async () => {
    const client = new QueryClient();
    client.setQueryData(['customer', 'wallets'], [{ id: 'private-wallet' }]);
    client.setQueryData(
      ['operations', 'users'],
      [{ id: 'private-admin-data' }],
    );

    render(
      <QueryClientProvider client={client}>
        <AppShell user={customer}>
          <p>Cached private transaction details</p>
        </AppShell>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('Cached private transaction details')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your session has expired. Sign in again to continue.',
    );
    await waitFor(() => {
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(replace).toHaveBeenCalledWith('/login');
      expect(refresh).toHaveBeenCalled();
    });
    client.clear();
  });
});
