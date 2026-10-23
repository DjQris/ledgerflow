import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { FailureModule } from './failure.module';
import { OpsJobsController } from './ops-jobs.controller';
import { OpsJobsService } from './ops-jobs.service';

@Module({
  imports: [AuditModule, FailureModule],
  controllers: [OpsJobsController],
  providers: [OpsJobsService],
})
export class OpsJobsModule {}
