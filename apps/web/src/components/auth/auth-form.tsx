'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Landmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from 'panelui-web/card';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/auth/client';
import { useLogin, useRegister } from '@/lib/auth/hooks';
import { safeNextPath } from '@/lib/auth/types';

type Mode = 'login' | 'register';
type Fields = { email: string; password: string; confirmation?: string };

function schemaFor(mode: Mode) {
  return z.object({
    email: z.email('Enter a valid email address.').max(254),
    password: z.string().min(1, 'Enter your password.'),
    confirmation: z.string().optional(),
  }).superRefine((value, context) => {
    if (mode !== 'register') return;
    if (Array.from(value.password).length < 12 ||
      new TextEncoder().encode(value.password).length > 72 ||
      value.password.trim().length === 0 || value.password.includes('\0')) {
      context.addIssue({ code: 'custom', path: ['password'], message: 'Use at least 12 characters and at most 72 UTF-8 bytes.' });
    }
    if (value.confirmation !== value.password) {
      context.addIssue({ code: 'custom', path: ['confirmation'], message: 'Passwords do not match.' });
    }
  });
}

export function AuthForm({ mode, next, notice }: { mode: Mode; next?: string; notice?: string }) {
  const router = useRouter();
  const login = useLogin();
  const registerUser = useRegister();
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<Fields>({
    resolver: zodResolver(schemaFor(mode)),
    defaultValues: { email: '', password: '', confirmation: '' },
  });

  const submit = handleSubmit(async (values) => {
    try {
      if (mode === 'login') {
        const user = await login.mutateAsync({ email: values.email, password: values.password });
        router.replace(safeNextPath(next, user.role));
        router.refresh();
      } else {
        await registerUser.mutateAsync({ email: values.email, password: values.password });
        router.replace('/login?registered=1');
      }
    } catch (error) {
      setError('root', {
        message: error instanceof ApiError ? error.message : 'The request failed. Please try again.',
      });
    }
  });

  const title = mode === 'login' ? 'Sign in' : 'Create an account';
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-5">
        <Link href="/" className="flex items-center justify-center gap-2 font-semibold">
          <Landmark className="size-6" aria-hidden="true" /> LedgerFlow
        </Link>
        <Card as="section">
          <Card.Header>
            <h1 className="text-xl font-semibold">{title}</h1>
            <Card.Description>
              {mode === 'login' ? 'Access your workspace securely.' : 'Register a customer account.'}
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {notice && <p role="status" className="mb-4 rounded-md border border-success p-3 text-sm">{notice}</p>}
            <form onSubmit={submit} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <input id="email" type="email" autoComplete="email" autoFocus {...register('email')}
                  aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined}
                  className="min-h-[var(--touch-target)] w-full rounded-md border border-input bg-background px-3 text-sm" />
                {errors.email && <p id="email-error" role="alert" className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <div className="flex rounded-md border border-input bg-background">
                  <input id="password" type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} {...register('password')}
                    aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : mode === 'register' ? 'password-hint' : undefined}
                    className="min-h-[var(--touch-target)] min-w-0 flex-1 rounded-md bg-transparent px-3 text-sm" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="flex min-w-[var(--touch-target)] items-center justify-center rounded-md hover:bg-accent">
                    {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
                {mode === 'register' && <p id="password-hint" className="text-xs text-muted-foreground">At least 12 characters; no more than 72 UTF-8 bytes.</p>}
                {errors.password && <p id="password-error" role="alert" className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              {mode === 'register' && <div className="space-y-1.5">
                <label htmlFor="confirmation" className="text-sm font-medium">Confirm password</label>
                <input id="confirmation" type="password" autoComplete="new-password" {...register('confirmation')}
                  aria-invalid={!!errors.confirmation} aria-describedby={errors.confirmation ? 'confirmation-error' : undefined}
                  className="min-h-[var(--touch-target)] w-full rounded-md border border-input bg-background px-3 text-sm" />
                {errors.confirmation && <p id="confirmation-error" role="alert" className="text-sm text-destructive">{errors.confirmation.message}</p>}
              </div>}
              {errors.root && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{errors.root.message}</p>}
              <Button type="submit" disabled={isSubmitting} className="w-full min-h-[var(--touch-target)]">
                {isSubmitting ? 'Please wait…' : title}
              </Button>
            </form>
          </Card.Content>
          <Card.Footer variant="panel">
            <p className="text-sm text-muted-foreground">
              {mode === 'login' ? 'New to LedgerFlow?' : 'Already registered?'}{' '}
              <Link className="font-medium text-foreground underline" href={mode === 'login' ? '/register' : '/login'}>
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </Link>
            </p>
          </Card.Footer>
        </Card>
      </div>
    </main>
  );
}
