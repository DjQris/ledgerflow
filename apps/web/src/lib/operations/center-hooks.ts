'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLedgerReconciliation,
  getOperationsAudit,
  getOperationsJob,
  getOperationsJobs,
  retryOperationsJob,
  type AuditFilter,
  type OperationsJobsFilter,
} from './center-client';

export const operationsCenterKeys = {
  jobs: (filter: OperationsJobsFilter) => ['operations-center', 'jobs', filter] as const,
  job: (id: string) => ['operations-center', 'job', id] as const,
  audit: (filter: AuditFilter) => ['operations-center', 'audit', filter] as const,
  reconciliation: ['operations-center', 'reconciliation'] as const,
};

export function useOperationsJobs(filter: OperationsJobsFilter) {
  return useQuery({ queryKey: operationsCenterKeys.jobs(filter), queryFn: () => getOperationsJobs(filter), staleTime: 20_000, refetchInterval: 60_000 });
}

export function useOperationsJob(id: string) {
  return useQuery({ queryKey: operationsCenterKeys.job(id), queryFn: () => getOperationsJob(id), staleTime: 20_000, refetchInterval: 60_000 });
}

export function useRetryOperationsJob(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => retryOperationsJob(id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['operations-center', 'jobs'] }),
        client.invalidateQueries({ queryKey: operationsCenterKeys.job(id) }),
      ]);
    },
  });
}

export function useOperationsAudit(filter: AuditFilter) {
  return useQuery({ queryKey: operationsCenterKeys.audit(filter), queryFn: () => getOperationsAudit(filter), staleTime: 30_000, refetchInterval: 60_000 });
}

export function useLedgerReconciliation() {
  return useQuery({ queryKey: operationsCenterKeys.reconciliation, queryFn: getLedgerReconciliation, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: false });
}
