import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { LedgerIntegrityService } from '../integrity/ledger-integrity.service';

async function verifyLedger(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const report = await application.get(LedgerIntegrityService).verify();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await application.close();
  }
}

void verifyLedger().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Ledger verification failed',
  );
  process.exitCode = 2;
});
