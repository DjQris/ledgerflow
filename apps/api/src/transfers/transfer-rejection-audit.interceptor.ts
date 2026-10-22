import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';

import { AuditService } from '../audit/audit.service';
import { TEST_OWNER_REFERENCE_PATTERN } from '../wallets/dto/create-wallet.dto';
import { POSITIVE_MINOR_UNITS_PATTERN } from './dto/transfer.command';
import { IdempotencyPayloadConflictError } from './errors/idempotency-payload-conflict.error';

interface TransferRequest {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class TransferRejectionAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TransferRequest>();
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(this.recordFailure(request, error)).pipe(
            mergeMap(() => throwError(() => error)),
          ),
        ),
      );
  }

  private async recordFailure(
    request: TransferRequest,
    error: unknown,
  ): Promise<void> {
    const body = isRecord(request.body) ? request.body : {};
    const sourceWalletId = body.sourceWalletId;
    const destinationWalletId = body.destinationWalletId;
    const amountMinor = body.amountMinor;
    const rawActor = request.headers['x-simulated-actor'];
    const actor =
      typeof rawActor === 'string' &&
      rawActor.length <= 100 &&
      TEST_OWNER_REFERENCE_PATTERN.test(rawActor)
        ? rawActor
        : undefined;
    const key = request.headers['idempotency-key'];

    await this.audit.recordRejected({
      action:
        error instanceof IdempotencyPayloadConflictError
          ? 'idempotency_conflict'
          : 'transfer_rejected',
      actorId: actor,
      actorType: actor ? 'simulated_owner' : 'unknown',
      entityId:
        typeof sourceWalletId === 'string' && isUUID(sourceWalletId, '4')
          ? sourceWalletId.toLowerCase()
          : randomUUID(),
      entityType:
        typeof sourceWalletId === 'string' && isUUID(sourceWalletId, '4')
          ? 'wallet'
          : 'transfer_attempt',
      metadata: {
        amountMinor:
          typeof amountMinor === 'string' &&
          amountMinor.length <= 19 &&
          POSITIVE_MINOR_UNITS_PATTERN.test(amountMinor)
            ? amountMinor
            : null,
        destinationWalletId:
          typeof destinationWalletId === 'string' &&
          isUUID(destinationWalletId, '4')
            ? destinationWalletId.toLowerCase()
            : null,
        httpStatus: error instanceof HttpException ? error.getStatus() : 500,
        keyFingerprint:
          typeof key === 'string' && key.length <= 255
            ? createHash('sha256').update(key).digest('hex')
            : null,
        reason:
          error instanceof IdempotencyPayloadConflictError
            ? 'KEY_PAYLOAD_MISMATCH'
            : error instanceof HttpException
              ? `HTTP_${error.getStatus()}`
              : 'UNEXPECTED_ERROR',
      },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
