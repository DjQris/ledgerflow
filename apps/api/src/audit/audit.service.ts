import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditOutcome } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventPageDto, AuditSearchQueryDto } from './dto/audit-query.dto';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';

export interface AuditEventInput {
  action: string;
  actorId?: string;
  actorType:
    'simulated_owner' | 'system' | 'internal_service' | 'user' | 'unknown';
  entityId: string;
  entityType: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSucceeded(
    transaction: Prisma.TransactionClient,
    event: AuditEventInput,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: { ...event, outcome: AuditOutcome.SUCCEEDED },
    });
  }

  async recordRejected(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { ...event, outcome: AuditOutcome.REJECTED },
    });
  }

  async recordRejectedInTransaction(
    transaction: Prisma.TransactionClient,
    event: AuditEventInput,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: { ...event, outcome: AuditOutcome.REJECTED },
    });
  }

  async list(limit: number): Promise<AuditEventResponseDto[]> {
    const events = await this.prisma.auditEvent.findMany({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return events.map((event) => this.toResponse(event));
  }

  async search(query: AuditSearchQueryDto): Promise<AuditEventPageDto> {
    const from = query.from ? this.readUtcDate(query.from) : undefined;
    const to = query.to ? this.readUtcDate(query.to) : undefined;
    if (from && to && from > to)
      throw new BadRequestException('from must not be after to');
    const searchOr: Prisma.AuditEventWhereInput[] = query.search
      ? [
          { action: { contains: query.search, mode: 'insensitive' } },
          { entityType: { contains: query.search, mode: 'insensitive' } },
          { actorId: { contains: query.search, mode: 'insensitive' } },
          ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            query.search,
          )
            ? [{ entityId: query.search }]
            : []),
        ]
      : [];
    const where: Prisma.AuditEventWhereInput = {
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.entityType
        ? { entityType: { equals: query.entityType, mode: 'insensitive' } }
        : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(from || to
        ? {
            occurredAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const [total, events] = await this.prisma.$transaction([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
    ]);
    return {
      data: events.map((event) => this.toResponse(event)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  private readUtcDate(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        'Audit dates must be valid ISO calendar days',
      );
    }
    return parsed;
  }

  private toResponse(event: {
    action: string;
    actorId: string | null;
    actorType: string | null;
    entityId: string;
    entityType: string;
    id: string;
    metadata: unknown;
    occurredAt: Date;
    outcome: AuditOutcome;
  }): AuditEventResponseDto {
    return {
      action: event.action,
      actorId: event.actorId,
      actorType: event.actorType,
      entityId: event.entityId,
      entityType: event.entityType,
      id: event.id,
      metadata: this.safeContext(event.action, event.metadata),
      occurredAt: event.occurredAt.toISOString(),
      outcome: event.outcome,
    };
  }

  private safeContext(
    action: string,
    metadata: unknown,
  ): Record<string, string | number> | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      return null;
    const source = metadata as Record<string, unknown>;
    const allowed: Record<string, readonly string[]> = {
      transfer_completed: ['amountMinor', 'journalId'],
      transfer_rejected: ['amountMinor', 'httpStatus', 'reason'],
      idempotency_conflict: ['amountMinor', 'httpStatus', 'reason'],
      development_opening_funding_posted: ['amountMinor', 'journalId'],
      account_role_changed: ['from', 'to'],
      background_retry_denied: ['reason'],
      background_retry_already_processed: ['eventId'],
      background_retry_resumed: ['eventId', 'source'],
      background_retry_requested: ['eventId', 'source'],
      login_rejected: ['reason'],
      registration_rejected: ['reason'],
      refresh_rejected: ['reason'],
      refresh_token_reuse_detected: ['reason'],
    };
    const output: Record<string, string | number> = {};
    for (const key of allowed[action] ?? []) {
      const value = source[key];
      if (
        key === 'amountMinor' &&
        typeof value === 'string' &&
        /^(0|[1-9]\d{0,18})$/.test(value)
      )
        output[key] = value;
      else if (
        key === 'httpStatus' &&
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 400 &&
        value <= 599
      )
        output[key] = value;
      else if (
        ['journalId', 'eventId'].includes(key) &&
        typeof value === 'string' &&
        /^[0-9a-f-]{36}$/i.test(value)
      )
        output[key] = value;
      else if (
        key === 'source' &&
        (value === 'worker' || value === 'dispatcher')
      )
        output[key] = value;
      else if (
        ['from', 'to'].includes(key) &&
        (value === 'CUSTOMER' || value === 'OPERATIONS' || value === 'ADMIN')
      )
        output[key] = value;
      else if (
        key === 'reason' &&
        typeof value === 'string' &&
        /^[A-Z0-9_]{1,64}$/.test(value)
      )
        output[key] = value;
    }
    return Object.keys(output).length ? output : null;
  }
}
