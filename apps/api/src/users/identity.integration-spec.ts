import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { UsersService, simulatedUserEmail } from './users.service';

jest.setTimeout(30_000);

describe('Phase 2A identity and wallet ownership PostgreSQL integration', () => {
  let prisma: PrismaService;
  let wallets: WalletsService;

  beforeAll(async () => {
    const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error('INTEGRATION_DATABASE_URL is required');
    const name = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (!name.startsWith('ledgerflow_phase1f_integration_')) {
      throw new Error(
        'Identity tests require an isolated integration database',
      );
    }

    const config = {
      get: jest.fn((key: keyof EnvironmentVariables) => {
        if (key === 'DATABASE_URL') return databaseUrl;
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    prisma = new PrismaService(config);
    await prisma.onModuleInit();
    wallets = new WalletsService(
      prisma,
      new AuditService(prisma),
      new UsersService(),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('links every existing wallet to a suspended, credential-free user', async () => {
    const [walletCount, usersWithWallets, orphanRows] = await Promise.all([
      prisma.wallet.count(),
      prisma.user.count({ where: { wallets: { some: {} } } }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS "count"
        FROM "wallets" AS wallet
        LEFT JOIN "users" AS owner ON owner."id" = wallet."user_id"
        WHERE owner."id" IS NULL
      `,
    ]);
    expect(usersWithWallets).toBe(walletCount);
    expect(orphanRows[0]?.count).toBe(0n);

    for (const reference of ['test-ada', 'test-tobi']) {
      const wallet = await prisma.wallet.findUnique({
        include: { user: true },
        where: { ownerReference: reference },
      });
      if (!wallet) continue;
      expect(wallet.userId).toBe(wallet.id);
      expect(wallet.user.email).toBe(simulatedUserEmail(wallet.id));
      expect(wallet.user.passwordHash).toBeNull();
      expect(wallet.user.role).toBe(UserRole.CUSTOMER);
      expect(wallet.user.status).toBe(UserStatus.SUSPENDED);
    }
  });

  it('provisions a user and wallet together without changing the public wallet response', async () => {
    const ownerReference = `test-phase2a-${randomUUID()}`;
    const before = await prisma.user.count();
    const wallet = await wallets.create({ ownerReference });
    const record = await prisma.wallet.findUniqueOrThrow({
      include: { user: true },
      where: { id: wallet.id },
    });

    expect(wallet).toMatchObject({
      balanceMinor: '0',
      ownerReference,
    });
    expect(record.userId).toBe(record.id);
    expect(record.user.email).toBe(simulatedUserEmail(record.id));
    expect(record.user.passwordHash).toBeNull();
    expect(record.user.status).toBe(UserStatus.SUSPENDED);
    expect(await prisma.user.count()).toBe(before + 1);

    await expect(wallets.create({ ownerReference })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await prisma.user.count()).toBe(before + 1);
    await expect(
      prisma.user.delete({ where: { id: record.userId } }),
    ).rejects.toThrow();
  });

  it('rejects wallets without a valid owner and non-normalized or duplicate emails', async () => {
    const missingOwnerWalletId = randomUUID();
    await expect(prisma.$executeRaw`
      INSERT INTO "wallets" ("id", "user_id", "owner_reference", "currency", "updated_at")
      VALUES (${missingOwnerWalletId}::uuid, ${randomUUID()}::uuid,
              ${`test-phase2a-missing-${randomUUID()}`}, 'NGN', CURRENT_TIMESTAMP)
    `).rejects.toThrow();
    const nullOwnerWalletId = randomUUID();
    await expect(prisma.$executeRaw`
      INSERT INTO "wallets" ("id", "user_id", "owner_reference", "currency", "updated_at")
      VALUES (${nullOwnerWalletId}::uuid, NULL,
              ${`test-phase2a-null-${randomUUID()}`}, 'NGN', CURRENT_TIMESTAMP)
    `).rejects.toThrow();
    expect(
      await prisma.wallet.count({
        where: { id: { in: [missingOwnerWalletId, nullOwnerWalletId] } },
      }),
    ).toBe(0);

    const email = `identity-${randomUUID()}@ledgerflow.invalid`;
    await expect(
      prisma.user.create({ data: { email: email.toUpperCase() } }),
    ).rejects.toThrow();
    const user = await prisma.user.create({ data: { email } });
    try {
      expect(user.passwordHash).toBeNull();
      await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('enforces session and hashed refresh-token relationships for future auth', async () => {
    const user = await prisma.user.create({
      data: { email: `session-${randomUUID()}@ledgerflow.invalid` },
    });
    const expiresAt = new Date(Date.now() + 60_000);
    const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

    try {
      const session = await prisma.authSession.create({
        data: { expiresAt, userId: user.id },
      });
      try {
        const parent = await prisma.refreshToken.create({
          data: { expiresAt, sessionId: session.id, tokenHash: hash() },
        });
        const child = await prisma.refreshToken.create({
          data: {
            expiresAt,
            parentTokenId: parent.id,
            sessionId: session.id,
            tokenHash: hash(),
          },
        });
        expect(child.parentTokenId).toBe(parent.id);
        await expect(
          prisma.refreshToken.create({
            data: {
              expiresAt,
              parentTokenId: parent.id,
              sessionId: session.id,
              tokenHash: hash(),
            },
          }),
        ).rejects.toThrow();
        await expect(
          prisma.refreshToken.create({
            data: {
              expiresAt,
              sessionId: session.id,
              tokenHash: 'not-a-hash',
            },
          }),
        ).rejects.toThrow();
        await prisma.refreshToken.delete({ where: { id: child.id } });
        await prisma.refreshToken.delete({ where: { id: parent.id } });
      } finally {
        await prisma.authSession.delete({ where: { id: session.id } });
      }
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
