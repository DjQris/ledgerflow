'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAdminUser, getAdminUsers, getOperationsMetrics, updateAdminUserRole, updateAdminUserStatus } from './client';
import type { StaffUserRole, StaffUserStatus } from './client';

export const operationsKeys = {
  metrics: (from?: string, to?: string) => ['operations', 'metrics', { from, to }] as const,
  users: (filters: { page: number; pageSize: number; search?: string; role?: string; status?: string }) => ['operations', 'users', filters] as const,
  user: (id: string) => ['operations', 'users', id] as const,
};

export function useOperationsMetrics(from?: string, to?: string) {
  return useQuery({ queryKey: operationsKeys.metrics(from, to), queryFn: () => getOperationsMetrics(from, to), staleTime: 30_000, refetchOnWindowFocus: true });
}

export function useAdminUsers(filters: { page: number; pageSize: number; search?: string; role?: string; status?: string }) {
  return useQuery({ queryKey: operationsKeys.users(filters), queryFn: () => getAdminUsers(filters), staleTime: 15_000, refetchOnWindowFocus: true });
}

export function useAdminUser(id: string) {
  return useQuery({ queryKey: operationsKeys.user(id), queryFn: () => getAdminUser(id), staleTime: 15_000 });
}

export function useUpdateAdminUserStatus(id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (status: StaffUserStatus) => updateAdminUserStatus(id, status), retry: false, onSuccess: async (user) => {
    client.setQueryData(operationsKeys.user(id), user);
    await client.invalidateQueries({ queryKey: ['operations', 'users'] });
  } });
}

export function useUpdateAdminUserRole(id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (role: StaffUserRole) => updateAdminUserRole(id, role), retry: false, onSuccess: async (user) => {
    client.setQueryData(operationsKeys.user(id), user);
    await client.invalidateQueries({ queryKey: ['operations', 'users'] });
  } });
}
