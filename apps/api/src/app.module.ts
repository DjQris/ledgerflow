import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';

import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { PrismaModule } from './prisma/prisma.module';
import { TransfersModule } from './transfers/transfers.module';
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
    HealthModule,
    LedgerModule,
    WalletsModule,
    TransfersModule,
  ],
})
export class AppModule {}
