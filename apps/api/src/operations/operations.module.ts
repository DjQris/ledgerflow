import { Module } from '@nestjs/common';

import { OperationsMetricsController } from './operations-metrics.controller';
import { OperationsMetricsService } from './operations-metrics.service';

@Module({
  controllers: [OperationsMetricsController],
  providers: [OperationsMetricsService],
})
export class OperationsModule {}
