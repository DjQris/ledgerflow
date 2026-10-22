import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditOutcome } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';

export interface AuditEventInput {
  action: string;
  actorId?: string;
  actorType: 'simulated_owner' | 'system' | 'internal_service' | 'unknown';
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

  async list(limit: number): Promise<AuditEventResponseDto[]> {
    const events = await this.prisma.auditEvent.findMany({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return events.map((event) => ({
      action: event.action,
      actorId: event.actorId,
      actorType: event.actorType,
      entityId: event.entityId,
      entityType: event.entityType,
      id: event.id,
      metadata: event.metadata,
      occurredAt: event.occurredAt.toISOString(),
      outcome: event.outcome,
    }));
  }
}
