import { UnrecoverableError } from 'bullmq';

import { classifyFailure, PermanentJobError } from './failure-classification';
import { safeJobId } from './failure.service';

describe('background failure classification', () => {
  it('marks invalid jobs as permanent using only fixed reason codes', () => {
    expect(classifyFailure(new PermanentJobError('INVALID_JOB'))).toEqual({
      category: 'permanent',
      reason: 'INVALID_JOB',
    });
    expect(classifyFailure(new UnrecoverableError('private value'))).toEqual({
      category: 'permanent',
      reason: 'INVALID_JOB',
    });
  });

  it('marks connection errors and timeouts temporary without leaking messages', () => {
    expect(classifyFailure({ code: 'P1001', message: 'sensitive' })).toEqual({
      category: 'temporary',
      reason: 'DATABASE_UNAVAILABLE',
    });
    expect(classifyFailure({ code: 'ETIMEDOUT' })).toEqual({
      category: 'temporary',
      reason: 'OPERATION_TIMEOUT',
    });
    expect(classifyFailure(new Error('secret from provider'))).toEqual({
      category: 'temporary',
      reason: 'PROCESSING_FAILED',
    });
  });

  it('hashes arbitrary job IDs before persistence', () => {
    const safe = safeJobId('secret-token-value');
    expect(safe).toMatch(/^invalid-[0-9a-f]{32}$/);
    expect(safe).toBe(safeJobId(safe));
    expect(safe).not.toContain('secret');
  });
});
