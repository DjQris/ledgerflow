import 'server-only';

import { cookies } from 'next/headers';
import { type UserProfile, type UserRole } from './types';

export type { UserProfile, UserRole } from './types';

const cookieNames = [
  'ledgerflow_access',
  'ledgerflow_refresh',
  '__Host-ledgerflow_access',
  '__Host-ledgerflow_refresh',
] as const;

export function backendUrl(path: string): string {
  const configured = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';
  const base = new URL(configured);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('API_BASE_URL must be an HTTP(S) URL without credentials or query');
  }
  return `${base.href.replace(/\/$/, '')}/${path}`;
}

export async function sessionCookieHeader(): Promise<string> {
  const store = await cookies();
  return cookieNames.flatMap((name) => {
    const value = store.get(name)?.value;
    return value && /^[A-Za-z0-9._~-]+$/.test(value) ? [`${name}=${value}`] : [];
  }).join('; ');
}

export async function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = await sessionCookieHeader();
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('accept', 'application/json');
  return fetch(backendUrl(path), { ...init, headers, cache: 'no-store', redirect: 'manual' });
}

export function parseProfile(input: unknown): UserProfile | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    typeof value.email !== 'string' ||
    !['CUSTOMER', 'OPERATIONS', 'ADMIN'].includes(String(value.role)) ||
    !['ACTIVE', 'SUSPENDED'].includes(String(value.status))
  ) return null;
  return {
    id: value.id,
    email: value.email,
    role: value.role as UserRole,
    status: value.status as UserProfile['status'],
  };
}

export async function currentSession(): Promise<{ status: number; profile: UserProfile | null }> {
  try {
    const response = await backendRequest('auth/me');
    if (response.status === 401) return { status: 401, profile: null };
    if (!response.ok) return { status: response.status, profile: null };
    const profile = parseProfile(await response.json());
    return profile?.status === 'ACTIVE'
      ? { status: 200, profile }
      : { status: 401, profile: null };
  } catch {
    return { status: 503, profile: null };
  }
}

export async function hasRefreshCookie(): Promise<boolean> {
  const store = await cookies();
  return cookieNames.some((name) => name.endsWith('refresh') && store.has(name));
}
