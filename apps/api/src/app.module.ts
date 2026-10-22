import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { resolve } from 'node:path';

import { AuditModule } from './audit/audit.module';
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
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';

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
    PrismaModule,
    UsersModule,
    AuthModule,
    AccessControlModule,
    SecurityModule,
    AuditModule,
    LedgerIntegrityModule,
    HealthModule,
    LedgerModule,
    WalletsModule,
    TransfersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: AuthOriginGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
