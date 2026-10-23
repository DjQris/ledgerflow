import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BackgroundConfigModule } from './background-config.module';
import { NotificationModule } from './notification.module';
import { QueueModule } from './queue.module';
import { TransferCompletedProcessor } from './transfer-completed.processor';

@Module({
  imports: [
    BackgroundConfigModule,
    PrismaModule,
    NotificationModule,
    QueueModule.forRole('worker'),
  ],
  providers: [TransferCompletedProcessor],
})
export class WorkerModule {}
