import { Module } from '@nestjs/common';
import { LedgerIntegrityController } from './ledger-integrity.controller';
import { LedgerIntegrityService } from './ledger-integrity.service';

@Module({
  controllers: [LedgerIntegrityController],
  providers: [LedgerIntegrityService],
  exports: [LedgerIntegrityService],
})
export class LedgerIntegrityModule {}
