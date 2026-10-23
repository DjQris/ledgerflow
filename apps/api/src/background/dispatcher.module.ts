import { Module } from '@nestjs/common';

import { OutboxModule } from '../outbox/outbox.module';
import { BackgroundConfigModule } from './background-config.module';
import { DispatcherService } from './dispatcher.service';
import { QueueModule } from './queue.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    BackgroundConfigModule,
    PrismaModule,
    OutboxModule,
    QueueModule.forRole('dispatcher'),
  ],
  providers: [DispatcherService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
