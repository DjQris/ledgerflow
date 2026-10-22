import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { LedgerService } from './ledger.service';

@Module({
  imports: [AuditModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
