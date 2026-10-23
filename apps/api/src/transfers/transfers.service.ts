import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
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
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransferCommand } from './dto/transfer.command';
import { TransferResult } from './dto/transfer-result.dto';
import {
  InsufficientFundsError,
  InvalidTransferError,
  SelfTransferError,
  TransferActorMismatchError,
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
  ownerReference: string;
  userId: string;
  userStatus: string;
  status: string;
  walletId: string;
}

export interface ValidatedTransferCommand {
  amountMinor: bigint;
  destinationWalletId: string;
  sourceWalletId: string;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: TransferCommand): Promise<TransferResult> {
    const command = this.prepare(input);

    try {
      return await this.prisma.$transaction(
        async (transaction) => this.executeInTransaction(transaction, command),
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

  prepare(input: TransferCommand): ValidatedTransferCommand {
    const command = this.validateCommand(input);
    if (command.sourceWalletId === command.destinationWalletId) {
      throw new SelfTransferError();
    }
    return command;
  }

  async executeInTransaction(
    transaction: Prisma.TransactionClient,
    command: ValidatedTransferCommand,
    idempotencyRecordId?: string,
    actor?: string,
    actorUserId?: string,
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

    if (actor && sourceWallet.ownerReference !== actor) {
      throw new TransferActorMismatchError();
    }
    if (
      actorUserId &&
      (sourceWallet.userId !== actorUserId ||
        sourceWallet.userStatus !== 'active')
    ) {
      throw new TransferActorMismatchError();
    }

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
        idempotencyRecordId,
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

    await this.audit.recordSucceeded(transaction, {
      action: 'transfer_completed',
      actorId: actorUserId ?? actor,
      actorType: actorUserId
        ? 'user'
        : actor
          ? 'simulated_owner'
          : 'internal_service',
      entityId: transferId,
      entityType: 'transfer',
      metadata: {
        amountMinor: serializeMinorUnits(command.amountMinor),
        destinationWalletId: command.destinationWalletId,
        journalId,
        sourceWalletId: command.sourceWalletId,
      },
    });

    await this.outbox.recordTransferCompleted(
      transaction,
      transferId,
      completedAt,
    );

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
        wallet."owner_reference" AS "ownerReference",
        wallet."user_id" AS "userId",
        owner."status"::text AS "userStatus",
        account."id" AS "accountId",
        account."cached_balance_minor" AS "cachedBalanceMinor"
      FROM "wallets" AS wallet
      JOIN "ledger_accounts" AS account ON account."wallet_id" = wallet."id"
      JOIN "users" AS owner ON owner."id" = wallet."user_id"
      WHERE wallet."id" = ${walletId}::uuid
      FOR UPDATE OF wallet, account, owner
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
        destinationWalletId: command.destinationWalletId.toLowerCase(),
        sourceWalletId: command.sourceWalletId.toLowerCase(),
      };
    } catch (error: unknown) {
      throw new InvalidTransferError('amountMinor is outside the valid range', {
        cause: error,
      });
    }
  }
}
