import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { Prisma } from '../generated/prisma/client';
import {
  TRANSFER_COMPLETED_TYPE,
  parseTransferCompletedPayload,
} from '../outbox/outbox-events';
import { PrismaService } from '../prisma/prisma.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredCompletion {
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  recipientUserId: string;
  transferId: string;
}

export type ProcessingResult = 'recorded' | 'duplicate';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async recordTransferCompletion(eventId: string): Promise<ProcessingResult> {
    if (!UUID_PATTERN.test(eventId)) throw new Error('Invalid event ID');
    return this.prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<StoredCompletion[]>(Prisma.sql`
          SELECT event."aggregate_id" AS "aggregateId",
            event."event_type" AS "eventType",
            event."event_version" AS "eventVersion", event."payload",
            wallet."user_id" AS "recipientUserId",
            transfer."id" AS "transferId"
          FROM "outbox_events" AS event
          JOIN "transfers" AS transfer ON transfer."id" = event."aggregate_id"
          JOIN "wallets" AS wallet ON wallet."id" = transfer."source_wallet_id"
          WHERE event."id" = ${eventId}::uuid
            AND event."event_type" = 'transfer.completed'
            AND transfer."status" = 'completed'
        `);
        const completion = rows[0];
        if (!completion || rows.length !== 1 || completion.eventVersion !== 1) {
          throw new Error('Transfer completion event is unavailable');
        }
        const payload = parseTransferCompletedPayload(completion.payload);
        if (
          payload.eventId !== eventId ||
          payload.transferId !== completion.transferId ||
          completion.aggregateId !== completion.transferId ||
          completion.eventType !== TRANSFER_COMPLETED_TYPE
        ) {
          throw new Error(
            'Transfer completion event does not match its aggregate',
          );
        }

        const reserved = await transaction.$queryRaw<
          Array<{ id: string }>
        >(Prisma.sql`
          INSERT INTO "processed_events" ("id", "event_type")
          VALUES (${eventId}::uuid, ${TRANSFER_COMPLETED_TYPE})
          ON CONFLICT ("id") DO NOTHING
          RETURNING "id"
        `);
        if (reserved.length === 0) return 'duplicate';

        const notificationId = randomUUID();
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "transaction_notifications" (
            "id", "event_id", "recipient_user_id", "transfer_id", "event_type"
          ) VALUES (
            ${notificationId}::uuid, ${eventId}::uuid,
            ${completion.recipientUserId}::uuid,
            ${completion.transferId}::uuid, ${TRANSFER_COMPLETED_TYPE}
          )
        `);
        return 'recorded';
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
