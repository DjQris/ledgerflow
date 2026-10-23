import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BackgroundEnvironment,
  redisConnection,
} from './background-environment';

export const TRANSFER_EVENTS_QUEUE = 'ledgerflow-transfer-events';

@Module({})
export class QueueModule {
  static forRole(role: 'dispatcher' | 'worker'): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<BackgroundEnvironment, true>) => ({
            connection: redisConnection(
              config.get('REDIS_URL', { infer: true }),
              role,
            ),
          }),
        }),
        BullModule.registerQueue({
          name: TRANSFER_EVENTS_QUEUE,
          defaultJobOptions: {
            attempts: 100,
            backoff: { type: 'fixed', delay: 5_000 },
            removeOnComplete: false,
            removeOnFail: false,
          },
        }),
      ],
      exports: [BullModule],
    };
  }
}
