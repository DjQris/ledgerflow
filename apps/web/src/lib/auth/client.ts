import type { UserProfile } from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type AuthPath = 'me' | 'login' | 'register' | 'refresh' | 'logout';

export async function authRequest<T>(path: AuthPath, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body
        ? { 'content-type': 'application/json', ...options.headers }
        : options.headers,
    });
  } catch {
    throw new ApiError(503, 'Service is temporarily unavailable. Please try again.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = payload && typeof payload === 'object' && 'message' in payload &&
      typeof payload.message === 'string'
      ? payload.message
      : 'The request could not be completed.';
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

let refreshInFlight: Promise<void> | null = null;

export function refreshSession(): Promise<void> {
  refreshInFlight ??= (async () => {
    const rotate = async () => {
      try {
        await authRequest<UserProfile>('me');
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      await authRequest<void>('refresh', { method: 'POST' });
    };
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request('ledgerflow-session-refresh', rotate);
    } else {
      await rotate();
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function getCurrentUser(): Promise<UserProfile> {
  try {
    return await authRequest<UserProfile>('me');
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refreshSession();
    return authRequest<UserProfile>('me');
  }
}
