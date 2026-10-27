'use client';

import type {
  CustomerTransferIntent,
  CustomerTransferResult,
} from './wallet-types';

export class TransferRequestError extends Error {
  constructor(
    message: string,
    readonly outcome: 'failed' | 'unknown',
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TransferRequestError';
  }
}

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonicalMinor = /^(0|[1-9]\d*)$/;

function isResult(value: unknown): value is CustomerTransferResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.transferId === 'string' &&
    uuidV4.test(result.transferId) &&
    typeof result.journalId === 'string' &&
    uuidV4.test(result.journalId) &&
    result.status === 'COMPLETED' &&
    typeof result.sourceWalletId === 'string' &&
    uuidV4.test(result.sourceWalletId) &&
    typeof result.destinationWalletId === 'string' &&
    uuidV4.test(result.destinationWalletId) &&
    typeof result.amountMinor === 'string' &&
    /^[1-9]\d*$/.test(result.amountMinor) &&
    typeof result.sourceBalanceMinor === 'string' &&
    canonicalMinor.test(result.sourceBalanceMinor) &&
    typeof result.destinationBalanceMinor === 'string' &&
    canonicalMinor.test(result.destinationBalanceMinor) &&
    typeof result.completedAt === 'string' &&
    Number.isFinite(Date.parse(result.completedAt))
  );
}

export async function submitCustomerTransfer(
  intent: CustomerTransferIntent,
): Promise<CustomerTransferResult> {
  let response: Response;
  try {
    response = await fetch('/api/customer/transfers', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': intent.idempotencyKey,
      },
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify({
        amountMinor: intent.amountMinor,
        destinationWalletId: intent.destinationWalletId,
        sourceWalletId: intent.sourceWalletId,
      }),
    });
  } catch {
    throw new TransferRequestError(
      'We could not confirm whether the transfer completed. Verify this same transfer before trying anything else.',
      'unknown',
      'TRANSFER_OUTCOME_UNKNOWN',
      503,
    );
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    throw new TransferRequestError(
      typeof payload.message === 'string'
        ? payload.message
        : 'The transfer request could not be completed.',
      payload.outcome === 'unknown' || response.status >= 500
        ? 'unknown'
        : 'failed',
      typeof payload.code === 'string'
        ? payload.code
        : 'TRANSFER_REQUEST_FAILED',
      response.status,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    response.status !== 201 ||
    !isResult(body) ||
    body.amountMinor !== intent.amountMinor ||
    body.sourceWalletId !== intent.sourceWalletId ||
    body.destinationWalletId !== intent.destinationWalletId
  ) {
    throw new TransferRequestError(
      'The transfer response could not be verified. Retry safely to check this same transfer.',
      'unknown',
      'TRANSFER_OUTCOME_UNKNOWN',
      502,
    );
  }
  return body;
}
