import { Module } from '@nestjs/common';
import { LedgerIntegrityService } from './ledger-integrity.service';

@Module({
  providers: [LedgerIntegrityService],
  exports: [LedgerIntegrityService],
})
export class LedgerIntegrityModule {}
