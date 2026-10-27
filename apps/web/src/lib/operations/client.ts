'use client';

import { ApiError, refreshSession } from '@/lib/auth/client';

export type StaffUserRole = 'CUSTOMER' | 'OPERATIONS' | 'ADMIN';
export type StaffUserStatus = 'ACTIVE' | 'SUSPENDED';

export type AdminUser = {
  id: string;
  email: string;
  role: StaffUserRole;
  status: StaffUserStatus;
  createdAt: string;
};

export type AdminUserPage = {
  data: AdminUser[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type OperationsMetrics = {
  from: string;
  to: string;
  timeZone: 'UTC';
  completedCount: number;
  completedMinor: string;
  recordedFailedTransferCount: number;
  registeredUsers: number;
  pendingRetries: number;
  pendingOutboxEvents: number;
  apiReadiness: 'ready' | 'unavailable';
  daily: { date: string; completedCount: number; failedCount: number; completedMinor: string }[];
  recentActivity: { action: string; entityType: string; outcome: string; actorType: string | null; occurredAt: string }[];
};

async function request<T>(path: string, init: RequestInit = {}, mayRefresh = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(503, 'Operations data is temporarily unavailable.');
  }
  if (response.status === 401 && mayRefresh) {
    try { await refreshSession(); return request<T>(path, init, false); }
    catch { throw new ApiError(401, 'Your session has ended. Sign in again.'); }
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'The request could not be completed.';
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export function getOperationsMetrics(from?: string, to?: string) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  return request<OperationsMetrics>(`/api/operations/metrics${query.size ? `?${query}` : ''}`);
}

export function getAdminUsers(filters: { page: number; pageSize: number; search?: string; role?: string; status?: string }) {
  const query = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
  if (filters.search) query.set('search', filters.search);
  if (filters.role) query.set('role', filters.role);
  if (filters.status) query.set('status', filters.status);
  return request<AdminUserPage>(`/api/operations/users?${query}`);
}

export function getAdminUser(id: string) {
  return request<AdminUser>(`/api/operations/users/${encodeURIComponent(id)}`);
}

export function updateAdminUserStatus(id: string, status: StaffUserStatus) {
  return request<AdminUser>(`/api/operations/users/${encodeURIComponent(id)}/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
  }, false);
}

export function updateAdminUserRole(id: string, role: StaffUserRole) {
  return request<AdminUser>(`/api/operations/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }),
  }, false);
}
