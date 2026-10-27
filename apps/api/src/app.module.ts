import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { AuditModule } from './audit/audit.module';
import { OpsJobsModule } from './background/ops-jobs.module';
import { AccessControlModule } from './access-control/access-control.module';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './access-control/guards/roles.guard';
import { AuthenticationGuard } from './auth/guards/authentication.guard';
import { AuthOriginGuard } from './auth/guards/auth-origin.guard';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { LedgerIntegrityModule } from './integrity/ledger-integrity.module';
import { LedgerModule } from './ledger/ledger.module';
import { PrismaModule } from './prisma/prisma.module';
import { TransfersModule } from './transfers/transfers.module';
import { SecurityModule } from './security/security.module';
import { CsrfGuard } from './security/csrf.guard';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { OperationsModule } from './operations/operations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env'),
      ],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      { name: 'ip', ttl: 60_000, limit: 600 },
      {
        name: 'account',
        ttl: 300_000,
        limit: 10,
        skipIf: (context) => {
          const req = context.switchToHttp().getRequest<{ path?: string }>();
          return !['/api/v1/auth/login', '/api/v1/auth/register'].includes(
            req.path ?? '',
          );
        },
        getTracker: (request) => {
          const req = request as { body?: unknown; ip?: string };
          const body = req.body;
          const email =
            typeof body === 'object' && body !== null && 'email' in body
              ? body.email
              : undefined;
          const identity =
            typeof email === 'string' && email.length <= 254
              ? email.trim().toLowerCase()
              : `ip:${req.ip ?? 'unknown'}`;
          return createHash('sha256').update(identity).digest('hex');
        },
      },
    ]),
    PrismaModule,
    UsersModule,
    AuthModule,
    AccessControlModule,
    SecurityModule,
    AuditModule,
    OpsJobsModule,
    LedgerIntegrityModule,
    HealthModule,
    LedgerModule,
    WalletsModule,
    TransfersModule,
    OperationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: AuthOriginGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
