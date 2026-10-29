import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';

import { UserRole, UserStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { PasswordService } from '../security/password.service';
import { FailureService } from '../background/failure.service';
import { PrismaService } from '../prisma/prisma.service';
import { requirePhase4IntegrationEnvironment } from './integration-safety';
import { AppModule } from '../app.module';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  requirePhase4IntegrationEnvironment({ redis: true });
  if (process.env.PHASE4_E2E_FIXTURES !== '1') {
    throw new Error('Phase 4 E2E fixtures require the isolated test runner');
  }

  const [action, id] = process.argv.slice(2);
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    if (action === 'operations-user') {
      const prisma = application.get(PrismaService);
      const passwords = application.get(PasswordService);
      const email = `phase4-ops-${randomUUID()}@example.test`;
      const password = randomBytes(24).toString('base64url');
      const passwordHash = await passwords.hash(password);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: UserRole.OPERATIONS,
          status: UserStatus.ACTIVE,
        },
        select: { id: true },
      });
      process.stdout.write(
        `${JSON.stringify({ email, password, userId: user.id })}\n`,
      );
      return;
    }

    if (action === 'fund-wallet') {
      if (typeof id !== 'string' || !UUID.test(id)) {
        throw new Error('fund-wallet requires a valid synthetic wallet UUID');
      }
      const ledger = application.get(LedgerService);
      await ledger.postDevelopmentOpeningFunding({
        amountMinor: 500_000n,
        externalReference: `phase4-e2e-opening-funding:${id}:v1`,
        walletId: id,
      });
      process.stdout.write('Synthetic opening funding posted.\n');
      return;
    }

    if (action === 'record-audit-job') {
      if (typeof id !== 'string' || !UUID.test(id)) {
        throw new Error('record-audit-job requires a synthetic transfer UUID');
      }
      const prisma = application.get(PrismaService);
      const events = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "outbox_events"
        WHERE "aggregate_id" = ${id}::uuid
          AND "event_type" = 'transfer.completed'
        ORDER BY "created_at" DESC LIMIT 1
      `);
      const event = events[0];
      if (!event) throw new Error('No synthetic transfer outbox event exists');
      const failures = application.get(FailureService);
      await failures.record({
        eventId: event.id,
        jobId: event.id,
        source: 'dispatcher',
        failure: { category: 'temporary', reason: 'PROCESSING_FAILED' },
        attempts: 1,
        exhausted: true,
      });
      process.stdout.write(
        'Synthetic failed-job inspection fixture recorded.\n',
      );
      return;
    }

    throw new Error('Unknown Phase 4 fixture action');
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Phase 4 fixture failed'}\n`,
  );
  process.exitCode = 1;
});
