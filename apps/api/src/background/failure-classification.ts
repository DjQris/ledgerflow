import { UnrecoverableError } from 'bullmq';

export const PERMANENT_REASONS = [
  'INVALID_JOB',
  'INVALID_EVENT_PAYLOAD',
  'UNSUPPORTED_EVENT_VERSION',
  'EVENT_DATA_UNAVAILABLE',
  'EVENT_MISMATCH',
] as const;
export const TEMPORARY_REASONS = [
  'DATABASE_UNAVAILABLE',
  'OPERATION_TIMEOUT',
  'PROCESSING_FAILED',
  'REDIS_UNAVAILABLE',
] as const;
export type PermanentReason = (typeof PERMANENT_REASONS)[number];

export class PermanentJobError extends Error {
  constructor(readonly reason: PermanentReason) {
    super(reason);
  }
}

export interface ClassifiedFailure {
  category: 'temporary' | 'permanent';
  reason: string;
}

export function classifyFailure(error: unknown): ClassifiedFailure {
  if (error instanceof PermanentJobError) {
    return { category: 'permanent', reason: error.reason };
  }
  if (error instanceof UnrecoverableError) {
    return {
      category: 'permanent',
      reason:
        PERMANENT_REASONS.find((reason) => reason === error.message) ??
        'INVALID_JOB',
    };
  }
  if (
    error instanceof Error &&
    TEMPORARY_REASONS.some((reason) => reason === error.message)
  ) {
    return { category: 'temporary', reason: error.message };
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  if (
    ['P1001', 'P1002', 'P1008', 'P1017', 'ECONNRESET', 'ECONNREFUSED'].includes(
      String(code),
    )
  ) {
    return { category: 'temporary', reason: 'DATABASE_UNAVAILABLE' };
  }
  if (code === 'ETIMEDOUT') {
    return { category: 'temporary', reason: 'OPERATION_TIMEOUT' };
  }
  return { category: 'temporary', reason: 'PROCESSING_FAILED' };
}
