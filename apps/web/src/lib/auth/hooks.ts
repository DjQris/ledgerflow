'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authRequest, getCurrentUser } from './client';
import { authKeys, type UserProfile } from './types';

export function useCurrentUser(initialData?: UserProfile) {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: getCurrentUser,
    initialData,
  });
}

export function useLogin() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      authRequest<UserProfile>('login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (user) => {
      cache.clear();
      cache.setQueryData(authKeys.me, user);
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      authRequest<UserProfile>('register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useLogout() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => authRequest<void>('logout', { method: 'POST' }),
    onSuccess: () => cache.clear(),
  });
}
