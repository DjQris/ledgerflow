import { Module } from '@nestjs/common';
import { LocalSimulationGuard } from '../common/guards/local-simulation.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, LocalSimulationGuard],
  exports: [AuditService],
})
export class AuditModule {}
