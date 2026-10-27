import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
const { login, registerUser } = vi.hoisted(() => ({ login: vi.fn(), registerUser: vi.fn() }));
vi.mock('@/lib/auth/hooks', () => ({
  useLogin: () => ({ mutateAsync: login }),
  useRegister: () => ({ mutateAsync: registerUser }),
}));

import { AuthForm } from './auth-form';

describe('authentication forms', () => {
  it('validates login fields before any request', async () => {
    render(<AuthForm mode="login" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('requires matching confirmation on registration', async () => {
    render(<AuthForm mode="register" />);
    await userEvent.type(screen.getByLabelText('Email'), 'customer@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a secure password 2026');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'something different 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
  });
});
