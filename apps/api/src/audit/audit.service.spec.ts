import { AuditOutcome } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditSearchQueryDto } from './dto/audit-query.dto';
import { AuditService } from './audit.service';
import { BadRequestException } from '@nestjs/common';

describe('AuditService', () => {
  it('returns only action-specific safe metadata and never forwards arbitrary payload fields', async () => {
    const event = {
      action: 'idempotency_conflict',
      actorId: 'user-id',
      actorType: 'user',
      entityId: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
      entityType: 'transfer_attempt',
      id: 'b5e0df47-36f4-4314-8a04-71464ba8996c',
      metadata: {
        amountMinor: '1200',
        httpStatus: 409,
        reason: 'KEY_PAYLOAD_MISMATCH',
        keyFingerprint: 'private-hash',
        rawBody: 'secret',
      },
      occurredAt: new Date('2026-10-27T10:00:00Z'),
      outcome: AuditOutcome.REJECTED,
    };
    const prisma = {
      auditEvent: { findMany: jest.fn().mockResolvedValue([event]) },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);
    const result = await service.list(10);

    expect(result[0].metadata).toEqual({
      amountMinor: '1200',
      httpStatus: 409,
      reason: 'KEY_PAYLOAD_MISMATCH',
    });
    expect(JSON.stringify(result)).not.toContain('private-hash');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('searches with bounded pagination and inclusive UTC date boundaries', async () => {
    const event = {
      action: 'background_retry_requested',
      actorId: 'operator-id',
      actorType: 'user',
      entityId: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
      entityType: 'failed_background_job',
      id: 'b5e0df47-36f4-4314-8a04-71464ba8996c',
      metadata: {
        eventId: 'c5e0df47-36f4-4314-8a04-71464ba8996c',
        source: 'worker',
      },
      occurredAt: new Date('2026-10-27T10:00:00Z'),
      outcome: AuditOutcome.SUCCEEDED,
    };
    const findManyCalls: unknown[] = [];
    const auditEvent = {
      count: jest.fn().mockResolvedValue(21),
      findMany: jest.fn((args: unknown) => {
        findManyCalls.push(args);
        return Promise.resolve([event]);
      }),
    };
    const prisma = {
      auditEvent,
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const service = new AuditService(prisma);
    const query = Object.assign(new AuditSearchQueryDto(), {
      page: 2,
      pageSize: 10,
      search: 'retry',
      entityType: 'failed_background_job',
      outcome: AuditOutcome.SUCCEEDED,
      from: '2026-10-27',
      to: '2026-10-27',
    });

    const result = await service.search(query);

    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
    });
    const args = findManyCalls[0] as {
      skip: number;
      take: number;
      where: Record<string, unknown>;
    };
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.where).toMatchObject({
      entityType: { equals: 'failed_background_job', mode: 'insensitive' },
      outcome: AuditOutcome.SUCCEEDED,
      occurredAt: {
        gte: new Date('2026-10-27T00:00:00.000Z'),
        lt: new Date('2026-10-28T00:00:00.000Z'),
      },
    });
    expect(result.data[0].metadata).toEqual({
      eventId: 'c5e0df47-36f4-4314-8a04-71464ba8996c',
      source: 'worker',
    });
  });

  it('rejects reversed date ranges before querying audit records', async () => {
    const auditEvent = { count: jest.fn(), findMany: jest.fn() };
    const prisma = {
      auditEvent,
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const query = Object.assign(new AuditSearchQueryDto(), {
      page: 1,
      pageSize: 20,
      from: '2026-10-28',
      to: '2026-10-27',
    });
    await expect(new AuditService(prisma).search(query)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(auditEvent.count).not.toHaveBeenCalled();
    expect(auditEvent.findMany).not.toHaveBeenCalled();
  });
});
