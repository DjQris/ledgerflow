import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './background/worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
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
  Logger.log('Transfer event worker stopping', 'BackgroundWorker');
  await app.close();
  Logger.log('Transfer event worker stopped', 'BackgroundWorker');
}

void bootstrap().catch(() => {
  Logger.error('Transfer event worker stopped unexpectedly');
  process.exitCode = 1;
});
