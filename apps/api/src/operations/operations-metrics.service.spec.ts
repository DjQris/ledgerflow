import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { OperationsMetricsService } from './operations-metrics.service';
import { OperationsMetricsQueryDto } from './operations-metrics-query.dto';

describe('OperationsMetricsService', () => {
  it('aggregates real totals and zero-fills daily chart values for the selected UTC range', async () => {
    const prisma = {
      transfer: {
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 2 }, _sum: { amountMinor: 125050n } }),
        count: jest.fn().mockResolvedValue(1),
      },
      user: { count: jest.fn().mockResolvedValue(9) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ pendingRetries: 2, pendingOutboxEvents: 3 }])
        .mockResolvedValueOnce([{ date: '2026-10-02', completedCount: 2, failedCount: 1, completedMinor: '125050' }]),
      auditEvent: {
        findMany: jest.fn().mockResolvedValue([{
          action: 'account_suspended', actorType: 'user', entityType: 'user',
          outcome: 'SUCCEEDED', occurredAt: new Date('2026-10-02T12:00:00.000Z'),
          metadata: { secret: 'must not be returned' },
        }]),
      },
    } as unknown as PrismaService;
    const service = new OperationsMetricsService(prisma);
    const query = Object.assign(new OperationsMetricsQueryDto(), { from: '2026-10-01', to: '2026-10-03' });

    const result = await service.get(query);

    expect(result).toMatchObject({
      from: '2026-10-01', to: '2026-10-03', timeZone: 'UTC',
      completedCount: 2, completedMinor: '125050', recordedFailedTransferCount: 1,
      registeredUsers: 9, pendingRetries: 2, pendingOutboxEvents: 3,
      daily: [
        { date: '2026-10-01', completedCount: 0, failedCount: 0, completedMinor: '0' },
        { date: '2026-10-02', completedCount: 2, failedCount: 1, completedMinor: '125050' },
        { date: '2026-10-03', completedCount: 0, failedCount: 0, completedMinor: '0' },
      ],
      recentActivity: [{ action: 'account_suspended', entityType: 'user', outcome: 'SUCCEEDED', actorType: 'user' }],
    });
    expect(JSON.stringify(result)).not.toContain('must not be returned');
  });

  it('rejects reversed and overlong ranges before reading operational data', async () => {
    const prisma = {
      transfer: { aggregate: jest.fn(), count: jest.fn() },
      user: { count: jest.fn() },
      $queryRaw: jest.fn(),
      auditEvent: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new OperationsMetricsService(prisma);

    await expect(service.get(Object.assign(new OperationsMetricsQueryDto(), { from: '2026-10-03', to: '2026-10-01' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get(Object.assign(new OperationsMetricsQueryDto(), { from: '2025-01-01', to: '2026-10-01' }))).rejects.toBeInstanceOf(BadRequestException);
  });
});
