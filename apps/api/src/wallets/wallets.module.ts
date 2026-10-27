import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { WalletsController } from './wallets.controller';
import { CustomerTransactionsController } from './customer-transactions.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [AuditModule, UsersModule],
  controllers: [WalletsController, CustomerTransactionsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
