import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { LocalSimulationGuard } from '../common/guards/local-simulation.guard';
import { OutboxModule } from '../outbox/outbox.module';
import { TransferIdempotencyService } from './transfer-idempotency.service';
import { TransferRejectionAuditInterceptor } from './transfer-rejection-audit.interceptor';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [AuditModule, OutboxModule],
  controllers: [TransfersController],
  providers: [
    LocalSimulationGuard,
    TransferIdempotencyService,
    TransferRejectionAuditInterceptor,
    TransfersService,
  ],
  exports: [TransfersService],
})
export class TransfersModule {}
