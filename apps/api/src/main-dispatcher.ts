import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Server } from 'node:http';

import { BackgroundEnvironment } from './background/background-environment';
import { DispatcherModule } from './background/dispatcher.module';
import { DispatcherService } from './background/dispatcher.service';
import {
  closeBackgroundHealthServer,
  startBackgroundHealthServer,
} from './background/health-server';
import { TRANSFER_EVENTS_QUEUE } from './background/queue.module';
import { checkBackgroundReadiness } from './background/readiness';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(DispatcherModule);
  const dispatcher = app.get(DispatcherService);
  const prisma = app.get(PrismaService);
  const queue = app.get<Queue>(getQueueToken(TRANSFER_EVENTS_QUEUE));
  const config =
    app.get<ConfigService<BackgroundEnvironment, true>>(ConfigService);
  let health: Server | undefined;
  const stop = () => dispatcher.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    health = await startBackgroundHealthServer({
      role: 'dispatcher',
      port: config.get('DISPATCHER_HEALTH_PORT', { infer: true }),
      isReady: () => checkBackgroundReadiness(prisma, queue),
    });
    Logger.log('Outbox dispatcher ready', 'BackgroundDispatcher');
    await dispatcher.runUntilStopped();
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    Logger.log('Outbox dispatcher stopping', 'BackgroundDispatcher');
    if (health) await closeBackgroundHealthServer(health);
    await app.close();
    Logger.log('Outbox dispatcher stopped', 'BackgroundDispatcher');
  }
}

void bootstrap().catch(() => {
  Logger.error('Outbox dispatcher stopped unexpectedly');
  process.exitCode = 1;
});
