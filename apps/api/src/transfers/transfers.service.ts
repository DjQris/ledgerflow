import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';

import {
  parseMinorUnits,
  serializeMinorUnits,
} from '../common/money/minor-units';
import { Prisma } from '../generated/prisma/client';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
  TransferStatus,
} from '../generated/prisma/enums';
import { NGN_CURRENCY } from '../ledger/ledger.constants';
import { PrismaService } from '../prisma/prisma.service';
import { TransferCommand } from './dto/transfer.command';
import { TransferResult } from './dto/transfer-result.dto';
import {
  InsufficientFundsError,
  InvalidTransferError,
  SelfTransferError,
  TransferConflictError,
  TransferError,
  TransferPersistenceError,
  WalletNotFoundError,
  WalletUnavailableError,
} from './errors/transfer.errors';

interface LockedWallet {
  accountId: string;
  cachedBalanceMinor: bigint;
  currency: string;
  status: string;
  walletId: string;
}

interface ValidatedTransferCommand {
  amountMinor: bigint;
  destinationWalletId: string;
  sourceWalletId: string;
}

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: TransferCommand): Promise<TransferResult> {
    const command = this.validateCommand(input);

    if (command.sourceWalletId === command.destinationWalletId) {
      throw new SelfTransferError();
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => this.executeLocked(transaction, command),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
    } catch (error: unknown) {
      if (error instanceof TransferError) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new TransferConflictError({ cause: error });
      }

      throw new TransferPersistenceError({ cause: error });
    }
  }

  private async executeLocked(
    transaction: Prisma.TransactionClient,
    command: ValidatedTransferCommand,
  ): Promise<TransferResult> {
    const lockedWallets = new Map<string, LockedWallet>();
    const walletIds = [
      command.sourceWalletId,
      command.destinationWalletId,
    ].sort();

    for (const walletId of walletIds) {
      const wallet = await this.lockWallet(transaction, walletId);

      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      lockedWallets.set(walletId, wallet);
    }

    const sourceWallet = lockedWallets.get(command.sourceWalletId);
    const destinationWallet = lockedWallets.get(command.destinationWalletId);

    if (!sourceWallet || !destinationWallet) {
      throw new TransferPersistenceError();
    }

    this.assertWalletAvailable(sourceWallet);
    this.assertWalletAvailable(destinationWallet);

    if (sourceWallet.cachedBalanceMinor < command.amountMinor) {
      throw new InsufficientFundsError();
    }

    const transferId = randomUUID();
    const journalId = randomUUID();

    await transaction.transfer.create({
      data: {
        amountMinor: command.amountMinor,
        currency: NGN_CURRENCY,
        destinationWalletId: command.destinationWalletId,
        id: transferId,
        sourceWalletId: command.sourceWalletId,
        status: TransferStatus.PENDING,
      },
    });

    await transaction.ledgerTransaction.create({
      data: {
        currency: NGN_CURRENCY,
        description: `Internal wallet transfer ${transferId}`,
        externalReference: `internal-transfer:${transferId}`,
        id: journalId,
        status: LedgerTransactionStatus.PENDING,
        type: LedgerTransactionType.TRANSFER,
      },
    });

    await transaction.ledgerEntry.createMany({
      data: [
        {
          accountId: sourceWallet.accountId,
          amountMinor: -command.amountMinor,
          description: `Transfer debit ${transferId}`,
          transactionId: journalId,
        },
        {
          accountId: destinationWallet.accountId,
          amountMinor: command.amountMinor,
          description: `Transfer credit ${transferId}`,
          transactionId: journalId,
        },
      ],
    });

    await transaction.ledgerTransaction.update({
      data: { status: LedgerTransactionStatus.POSTED },
      where: { id: journalId },
    });

    const completedAt = new Date();
    await transaction.transfer.update({
      data: {
        completedAt,
        ledgerTransactionId: journalId,
        status: TransferStatus.COMPLETED,
      },
      where: { id: transferId },
    });

    await transaction.auditEvent.create({
      data: {
        action: 'completed',
        actorType: 'internal_service',
        entityId: transferId,
        entityType: 'transfer',
        metadata: {
          amountMinor: serializeMinorUnits(command.amountMinor),
          destinationWalletId: command.destinationWalletId,
          journalId,
          sourceWalletId: command.sourceWalletId,
        },
      },
    });

    const balances = await transaction.ledgerAccount.findMany({
      select: { cachedBalanceMinor: true, walletId: true },
      where: {
        walletId: {
          in: [command.sourceWalletId, command.destinationWalletId],
        },
      },
    });
    const sourceBalance = balances.find(
      (account) => account.walletId === command.sourceWalletId,
    );
    const destinationBalance = balances.find(
      (account) => account.walletId === command.destinationWalletId,
    );

    if (!sourceBalance || !destinationBalance) {
      throw new TransferPersistenceError();
    }

    return {
      amountMinor: serializeMinorUnits(command.amountMinor),
      completedAt: completedAt.toISOString(),
      destinationBalanceMinor: serializeMinorUnits(
        destinationBalance.cachedBalanceMinor,
      ),
      destinationWalletId: command.destinationWalletId,
      journalId,
      sourceBalanceMinor: serializeMinorUnits(sourceBalance.cachedBalanceMinor),
      sourceWalletId: command.sourceWalletId,
      status: TransferStatus.COMPLETED,
      transferId,
    };
  }

  private async lockWallet(
    transaction: Prisma.TransactionClient,
    walletId: string,
  ): Promise<LockedWallet | null> {
    const rows = await transaction.$queryRaw<LockedWallet[]>(Prisma.sql`
      SELECT
        wallet."id" AS "walletId",
        wallet."status"::text AS "status",
        wallet."currency" AS "currency",
        account."id" AS "accountId",
        account."cached_balance_minor" AS "cachedBalanceMinor"
      FROM "wallets" AS wallet
      JOIN "ledger_accounts" AS account ON account."wallet_id" = wallet."id"
      WHERE wallet."id" = ${walletId}::uuid
      FOR UPDATE OF wallet, account
    `);

    return rows[0] ?? null;
  }

  private assertWalletAvailable(wallet: LockedWallet): void {
    if (wallet.status !== 'active' || wallet.currency !== NGN_CURRENCY) {
      throw new WalletUnavailableError(wallet.walletId);
    }
  }

  private validateCommand(input: TransferCommand): ValidatedTransferCommand {
    const command = plainToInstance(TransferCommand, input);
    const validationErrors = validateSync(command, {
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      whitelist: true,
    });

    if (validationErrors.length > 0) {
      const messages = validationErrors.flatMap((error) =>
        Object.values(error.constraints ?? {}),
      );
      throw new InvalidTransferError(
        messages.join('; ') || 'The transfer command is invalid',
      );
    }

    try {
      return {
        amountMinor: parseMinorUnits(command.amountMinor),
        destinationWalletId: command.destinationWalletId,
        sourceWalletId: command.sourceWalletId,
      };
    } catch (error: unknown) {
      throw new InvalidTransferError('amountMinor is outside the valid range', {
        cause: error,
      });
    }
  }
}
