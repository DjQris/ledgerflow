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
              config.get('REDIS_CONNECT_TIMEOUT_MS', { infer: true }),
            ),
          }),
        }),
        BullModule.registerQueueAsync({
          name: TRANSFER_EVENTS_QUEUE,
          inject: [ConfigService],
          useFactory: (config: ConfigService<BackgroundEnvironment, true>) => ({
            defaultJobOptions: {
              attempts: config.get('BACKGROUND_JOB_MAX_ATTEMPTS', {
                infer: true,
              }),
              backoff: {
                type: 'exponential',
                delay: config.get('BACKGROUND_RETRY_DELAY_MS', { infer: true }),
                jitter: 0.5,
              },
              removeOnComplete: false,
              removeOnFail: false,
            },
          }),
        }),
      ],
      exports: [BullModule],
    };
  }
}
