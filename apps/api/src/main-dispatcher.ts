import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DispatcherModule } from './background/dispatcher.module';
import { DispatcherService } from './background/dispatcher.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(DispatcherModule);
  const dispatcher = app.get(DispatcherService);
  const stop = () => dispatcher.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    Logger.log('Outbox dispatcher ready', 'BackgroundDispatcher');
    await dispatcher.runUntilStopped();
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    Logger.log('Outbox dispatcher stopping', 'BackgroundDispatcher');
    await app.close();
    Logger.log('Outbox dispatcher stopped', 'BackgroundDispatcher');
  }
}

void bootstrap().catch(() => {
  Logger.error('Outbox dispatcher stopped unexpectedly');
  process.exitCode = 1;
});
