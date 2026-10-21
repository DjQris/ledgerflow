import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { EnvironmentVariables } from '../config/environment';
import { LedgerService } from '../ledger/ledger.service';
import { WalletsService } from '../wallets/wallets.service';

const DEVELOPMENT_WALLETS = [
  {
    amountMinor: 500_000n,
    externalReference: 'development-opening-funding:test-ada:v1',
    ownerReference: 'test-ada',
  },
  {
    amountMinor: 250_000n,
    externalReference: 'development-opening-funding:test-tobi:v1',
    ownerReference: 'test-tobi',
  },
] as const;

async function seedDevelopmentWallets(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'log', 'warn'],
  });

  try {
    const config = application.get(ConfigService<EnvironmentVariables, true>);

    if (config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error('Development seed is disabled in production');
    }

    const wallets = application.get(WalletsService);
    const ledger = application.get(LedgerService);

    for (const seedWallet of DEVELOPMENT_WALLETS) {
      const existingWallet = await wallets.findByOwnerReference(
        seedWallet.ownerReference,
      );
      const wallet =
        existingWallet ??
        (await wallets.create({
          ownerReference: seedWallet.ownerReference,
        }));

      const funding = await ledger.postDevelopmentOpeningFunding({
        amountMinor: seedWallet.amountMinor,
        externalReference: seedWallet.externalReference,
        walletId: wallet.id,
      });

      console.log(
        `${seedWallet.ownerReference}: wallet=${wallet.id} balance-funded=${funding.amountMinor} journal=${funding.journalId}`,
      );
    }
  } finally {
    await application.close();
  }
}

void seedDevelopmentWallets().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Development seed failed',
  );
  process.exitCode = 1;
});
