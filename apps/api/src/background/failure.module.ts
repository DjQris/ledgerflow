import { Module } from '@nestjs/common';

import { FailureService } from './failure.service';

@Module({
  providers: [FailureService],
  exports: [FailureService],
})
export class FailureModule {}
