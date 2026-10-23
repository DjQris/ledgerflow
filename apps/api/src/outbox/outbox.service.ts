import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  createTransferCompletedPayload,
  parseTransferCompletedPayload,
  TRANSFER_COMPLETED_TYPE,
  TRANSFER_COMPLETED_VERSION,
  TransferCompletedPayload,
} from './outbox-events';

const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9.:-]{0,99}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = ['DELIVERY_FAILED', 'INVALID_PAYLOAD'] as const;
export type OutboxErrorCode = (typeof ERROR_CODES)[number];

export interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  attempts: number;
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: Date;
}

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async recordTransferCompleted(
    transaction: Prisma.TransactionClient,
    transferId: string,
    occurredAt: Date,
  ): Promise<void> {
    const payload = createTransferCompletedPayload(transferId, occurredAt);
    parseTransferCompletedPayload(payload);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "outbox_events" (
        "id", "event_type", "event_version", "aggregate_id",
        "aggregate_type", "payload"
      ) VALUES (
        ${payload.eventId}::uuid, ${TRANSFER_COMPLETED_TYPE},
        ${TRANSFER_COMPLETED_VERSION}, ${transferId}::uuid,
        'transfer', ${JSON.stringify(payload)}::jsonb
      )
    `);
  }

  // One statement atomically claims a bounded batch. Expired leases are
  // reclaimable; SKIP LOCKED prevents competing claimers from waiting on rows.
  async claimAvailable(
    worker: string,
    limit: number,
    leaseMilliseconds: number,
    eventType?: string,
  ): Promise<ClaimedOutboxEvent[]> {
    this.assertWorker(worker);
    if (eventType !== undefined && !EVENT_TYPE_PATTERN.test(eventType)) {
      throw new Error('Invalid event type');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Claim limit must be between 1 and 100');
    }
    if (
      !Number.isInteger(leaseMilliseconds) ||
      leaseMilliseconds < 1_000 ||
      leaseMilliseconds > 300_000
    ) {
      throw new Error('Lease duration must be between 1000 and 300000 ms');
    }
    return this.prisma.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id" FROM "outbox_events"
        WHERE (("status" = 'pending' AND "next_attempt_at" <= CURRENT_TIMESTAMP)
           OR ("status" = 'claimed' AND "lease_expires_at" <= CURRENT_TIMESTAMP))
        ${eventType === undefined ? Prisma.empty : Prisma.sql`AND "event_type" = ${eventType}`}
        ORDER BY "created_at", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "outbox_events" AS event
      SET "status" = 'claimed',
          "attempts" = event."attempts" + 1,
          "lease_owner" = ${worker},
          "lease_token" = gen_random_uuid(),
          "lease_expires_at" = CURRENT_TIMESTAMP + (${leaseMilliseconds} * INTERVAL '1 millisecond'),
          "last_error" = NULL
      FROM candidate WHERE event."id" = candidate."id"
      RETURNING event."id", event."event_type" AS "eventType",
        event."event_version" AS "eventVersion",
        event."aggregate_id" AS "aggregateId",
        event."aggregate_type" AS "aggregateType",
        event."payload", event."attempts",
        event."lease_owner" AS "leaseOwner",
        event."lease_token" AS "leaseToken",
        event."lease_expires_at" AS "leaseExpiresAt"
    `);
  }

  async markPublished(
    id: string,
    worker: string,
    token: string,
  ): Promise<boolean> {
    this.assertClaim(id, worker, token);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "outbox_events" SET "status" = 'published',
        "published_at" = CURRENT_TIMESTAMP, "lease_owner" = NULL,
        "lease_token" = NULL, "lease_expires_at" = NULL
      WHERE "id" = ${id}::uuid AND "status" = 'claimed'
        AND "lease_owner" = ${worker} AND "lease_token" = ${token}::uuid
        AND "lease_expires_at" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
    return rows.length === 1;
  }

  async scheduleRetry(
    id: string,
    worker: string,
    token: string,
    delayMilliseconds: number,
    errorCode: OutboxErrorCode,
  ): Promise<boolean> {
    this.assertClaim(id, worker, token);
    if (
      !Number.isInteger(delayMilliseconds) ||
      delayMilliseconds < 1_000 ||
      delayMilliseconds > 86_400_000
    ) {
      throw new Error('Retry delay must be between 1000 and 86400000 ms');
    }
    if (!ERROR_CODES.includes(errorCode)) {
      throw new Error('Unsupported outbox error code');
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "outbox_events" SET "status" = 'pending',
        "next_attempt_at" = CURRENT_TIMESTAMP + (${delayMilliseconds} * INTERVAL '1 millisecond'),
        "last_error" = ${errorCode}, "lease_owner" = NULL,
        "lease_token" = NULL, "lease_expires_at" = NULL
      WHERE "id" = ${id}::uuid AND "status" = 'claimed'
        AND "lease_owner" = ${worker} AND "lease_token" = ${token}::uuid
        AND "lease_expires_at" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
    return rows.length === 1;
  }

  parseTransferCompleted(value: unknown): TransferCompletedPayload {
    return parseTransferCompletedPayload(value);
  }

  private assertWorker(worker: string): void {
    if (!WORKER_PATTERN.test(worker)) throw new Error('Invalid worker ID');
  }

  private assertClaim(id: string, worker: string, token: string): void {
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(token)) {
      throw new Error('Invalid claim ID or token');
    }
    this.assertWorker(worker);
  }
}
