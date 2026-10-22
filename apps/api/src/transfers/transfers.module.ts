import { Module } from '@nestjs/common';

import { LocalSimulationGuard } from './local-simulation.guard';
import { TransferIdempotencyService } from './transfer-idempotency.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [TransfersController],
  providers: [
    LocalSimulationGuard,
    TransferIdempotencyService,
    TransfersService,
  ],
  exports: [TransfersService],
})
export class TransfersModule {}
