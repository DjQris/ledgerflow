import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { Prisma } from '../generated/prisma/client';
import { IdempotencyStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { TEST_OWNER_REFERENCE_PATTERN } from '../wallets/dto/create-wallet.dto';
import { TransferCommand } from './dto/transfer.command';
import { TransferInspectionDto } from './dto/transfer-http.dto';
import { TransferResult } from './dto/transfer-result.dto';
import {
  TransferConflictError,
  TransferError,
  TransferPersistenceError,
} from './errors/transfer.errors';
import { TransfersService } from './transfers.service';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const RESPONSE_STATUS = 201;

interface ReservedIdempotencyRecord {
  id: string;
}

@Injectable()
export class TransferIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
  ) {}

  async submit(
    input: TransferCommand,
    rawKey: string | undefined,
    rawActor: string | undefined,
  ): Promise<TransferResult> {
    const key = this.validateKey(rawKey);
    const actor = this.validateActor(rawActor);
    const command = this.transfers.prepare(input);
    const scope = `transfer:${this.hash(actor)}`;
    const requestHash = this.hash(
      JSON.stringify({
        amountMinor: command.amountMinor.toString(),
        destinationWalletId: command.destinationWalletId,
        sourceWalletId: command.sourceWalletId,
      }),
    );

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const id = randomUUID();
          const reserved = await transaction.$queryRaw<
            ReservedIdempotencyRecord[]
          >(Prisma.sql`
            INSERT INTO "idempotency_records"
              ("id", "scope", "key", "request_hash", "updated_at")
            VALUES (${id}::uuid, ${scope}, ${key}, ${requestHash}, CURRENT_TIMESTAMP)
            ON CONFLICT ("scope", "key") DO NOTHING
            RETURNING "id"
          `);

          if (reserved.length === 0) {
            const existing = await transaction.idempotencyRecord.findUnique({
              where: { scope_key: { scope, key } },
            });
            if (!existing) {
              throw new TransferConflictError();
            }
            if (existing.requestHash !== requestHash) {
              throw new ConflictException(
                'Idempotency-Key is already bound to a different transfer request',
              );
            }
            if (
              existing.status !== IdempotencyStatus.COMPLETED ||
              existing.responseStatus !== RESPONSE_STATUS ||
              !isTransferResult(existing.responseBody)
            ) {
              throw new TransferConflictError();
            }
            return existing.responseBody;
          }

          const result = await this.transfers.executeInTransaction(
            transaction,
            command,
            id,
            actor,
          );
          await transaction.idempotencyRecord.update({
            data: {
              responseBody: result as unknown as Prisma.InputJsonValue,
              responseStatus: RESPONSE_STATUS,
              status: IdempotencyStatus.COMPLETED,
            },
            where: { id },
          });
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10_000,
          timeout: 30_000,
        },
      );
    } catch (error: unknown) {
      if (error instanceof HttpException || error instanceof TransferError) {
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

  async list(rawActor: string | undefined): Promise<TransferInspectionDto[]> {
    const actor = this.validateActor(rawActor);
    const transfers = await this.prisma.transfer.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: { sourceWallet: { ownerReference: actor } },
    });

    return transfers.map((transfer) => ({
      amountMinor: transfer.amountMinor.toString(),
      completedAt: transfer.completedAt?.toISOString() ?? null,
      destinationWalletId: transfer.destinationWalletId,
      journalId: transfer.ledgerTransactionId,
      sourceWalletId: transfer.sourceWalletId,
      status: transfer.status,
      transferId: transfer.id,
    }));
  }

  private validateKey(key: string | undefined): string {
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be 1 to 255 characters using letters, digits, dot, underscore, colon, or hyphen',
      );
    }
    return key;
  }

  private validateActor(actor: string | undefined): string {
    if (
      typeof actor !== 'string' ||
      actor.length > 100 ||
      !TEST_OWNER_REFERENCE_PATTERN.test(actor)
    ) {
      throw new BadRequestException(
        'X-Simulated-Actor must be a test-* owner reference',
      );
    }
    return actor;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

function isTransferResult(value: unknown): value is TransferResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.transferId === 'string' &&
    typeof result.journalId === 'string' &&
    typeof result.amountMinor === 'string' &&
    typeof result.sourceBalanceMinor === 'string' &&
    typeof result.destinationBalanceMinor === 'string' &&
    typeof result.completedAt === 'string'
  );
}
