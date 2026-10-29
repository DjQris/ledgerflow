import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { EnvironmentVariables } from '../config/environment';
import { requirePhase4IntegrationEnvironment } from '../database/integration-safety';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

describe('PostgreSQL outbox claims', () => {
  let prisma: PrismaService;
  let outbox: OutboxService;
  let config: ConfigService<EnvironmentVariables, true>;

  beforeAll(async () => {
    const { databaseUrl } = requirePhase4IntegrationEnvironment();
    config = {
      get: jest.fn((key: keyof EnvironmentVariables) =>
        key === 'DATABASE_URL' ? databaseUrl : undefined,
      ),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    prisma = new PrismaService(config);
    await prisma.onModuleInit();
    outbox = new OutboxService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  async function insertTestEvent(): Promise<{ id: string; type: string }> {
    const id = randomUUID();
    const aggregateId = randomUUID();
    const type = `phase2e.test.${randomUUID()}`;
    const payload = JSON.stringify({
      eventId: id,
      eventType: type,
      eventVersion: 1,
    });
    await prisma.$executeRaw`
      INSERT INTO "outbox_events" (
        "id", "event_type", "event_version", "aggregate_id", "aggregate_type", "payload"
      ) VALUES (${id}::uuid, ${type}, 1, ${aggregateId}::uuid, 'test', ${payload}::jsonb)
    `;
    return { id, type };
  }

  it('allows only one of two concurrent claimers to own an active lease', async () => {
    const event = await insertTestEvent();
    const [first, second] = await Promise.all([
      outbox.claimAvailable('worker-a', 1, 30_000, event.type),
      outbox.claimAvailable('worker-b', 1, 30_000, event.type),
    ]);
    expect(first.length + second.length).toBe(1);
    const claim = first[0] ?? second[0];
    expect(claim).toMatchObject({ id: event.id, attempts: 1 });
    expect(
      await outbox.claimAvailable('worker-c', 1, 30_000, event.type),
    ).toEqual([]);
    expect(
      await outbox.markPublished(event.id, claim.leaseOwner, claim.leaseToken),
    ).toBe(true);
    expect(
      await outbox.claimAvailable('worker-c', 1, 30_000, event.type),
    ).toEqual([]);
  });

  it('recovers expired leases and fences stale workers', async () => {
    const event = await insertTestEvent();
    const [oldClaim] = await outbox.claimAvailable(
      'worker-old',
      1,
      30_000,
      event.type,
    );
    expect(oldClaim).toBeDefined();
    await prisma.$executeRaw`
      UPDATE "outbox_events" SET "lease_expires_at" = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE "id" = ${event.id}::uuid
    `;
    const [newClaim] = await outbox.claimAvailable(
      'worker-old',
      1,
      30_000,
      event.type,
    );
    expect(newClaim).toMatchObject({ id: event.id, attempts: 2 });
    expect(newClaim.leaseToken).not.toBe(oldClaim.leaseToken);
    expect(
      await outbox.markPublished(
        event.id,
        oldClaim.leaseOwner,
        oldClaim.leaseToken,
      ),
    ).toBe(false);
    expect(
      await outbox.scheduleRetry(
        event.id,
        oldClaim.leaseOwner,
        oldClaim.leaseToken,
        1_000,
        'DELIVERY_FAILED',
      ),
    ).toBe(false);
    expect(
      await outbox.markPublished(
        event.id,
        newClaim.leaseOwner,
        newClaim.leaseToken,
      ),
    ).toBe(true);
  });

  it('schedules bounded retries without storing raw error details', async () => {
    const event = await insertTestEvent();
    const [claim] = await outbox.claimAvailable(
      'worker-retry',
      1,
      30_000,
      event.type,
    );
    expect(
      await outbox.scheduleRetry(
        event.id,
        claim.leaseOwner,
        claim.leaseToken,
        60_000,
        'DELIVERY_FAILED',
      ),
    ).toBe(true);
    expect(
      await outbox.claimAvailable('worker-other', 1, 30_000, event.type),
    ).toEqual([]);
    const rows = await prisma.$queryRaw<
      Array<{ lastError: string; attempts: number }>
    >`
      SELECT "last_error" AS "lastError", "attempts" FROM "outbox_events"
      WHERE "id" = ${event.id}::uuid
    `;
    expect(rows[0]).toMatchObject({
      lastError: 'DELIVERY_FAILED',
      attempts: 1,
    });
    await prisma.$executeRaw`
      UPDATE "outbox_events" SET "next_attempt_at" = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE "id" = ${event.id}::uuid
    `;
    const [retried] = await outbox.claimAvailable(
      'worker-other',
      1,
      30_000,
      event.type,
    );
    expect(retried.attempts).toBe(2);
    expect(
      await outbox.markPublished(
        event.id,
        retried.leaseOwner,
        retried.leaseToken,
      ),
    ).toBe(true);
  });

  it('keeps the event durable across a new database client instance', async () => {
    const event = await insertTestEvent();
    const restartedClient = new PrismaService(config);
    await restartedClient.onModuleInit();
    try {
      const rows = await restartedClient.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status"::text AS "status" FROM "outbox_events"
        WHERE "id" = ${event.id}::uuid
      `;
      expect(rows).toEqual([{ id: event.id, status: 'pending' }]);
      const [claim] = await new OutboxService(restartedClient).claimAvailable(
        'worker-restarted',
        1,
        30_000,
        event.type,
      );
      expect(claim.id).toBe(event.id);
      expect(
        await new OutboxService(restartedClient).markPublished(
          event.id,
          claim.leaseOwner,
          claim.leaseToken,
        ),
      ).toBe(true);
    } finally {
      await restartedClient.onModuleDestroy();
    }
  });
});
