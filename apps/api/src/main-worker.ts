import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Server } from 'node:http';

import { BackgroundEnvironment } from './background/background-environment';
import {
  closeBackgroundHealthServer,
  startBackgroundHealthServer,
} from './background/health-server';
import { TRANSFER_EVENTS_QUEUE } from './background/queue.module';
import { checkBackgroundReadiness } from './background/readiness';
import { TransferCompletedProcessor } from './background/transfer-completed.processor';
import { WorkerModule } from './background/worker.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const prisma = app.get(PrismaService);
  const queue = app.get<Queue>(getQueueToken(TRANSFER_EVENTS_QUEUE));
  const worker = app.get(TransferCompletedProcessor).worker;
  const config =
    app.get<ConfigService<BackgroundEnvironment, true>>(ConfigService);
  let health: Server | undefined;
  try {
    health = await startBackgroundHealthServer({
      role: 'worker',
      port: config.get('WORKER_HEALTH_PORT', { infer: true }),
      isReady: () => checkBackgroundReadiness(prisma, queue, worker),
    });
    Logger.log('Transfer event worker ready', 'BackgroundWorker');
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        resolve();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  } finally {
    Logger.log('Transfer event worker stopping', 'BackgroundWorker');
    if (health) await closeBackgroundHealthServer(health);
    await app.close();
    Logger.log('Transfer event worker stopped', 'BackgroundWorker');
  }
}

void bootstrap().catch(() => {
  Logger.error('Transfer event worker stopped unexpectedly');
  process.exitCode = 1;
});
