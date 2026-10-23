import { randomUUID } from 'node:crypto';

export const TRANSFER_COMPLETED_TYPE = 'transfer.completed';
export const TRANSFER_COMPLETED_VERSION = 1;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TransferCompletedPayload {
  eventType: typeof TRANSFER_COMPLETED_TYPE;
  eventVersion: typeof TRANSFER_COMPLETED_VERSION;
  eventId: string;
  transferId: string;
  occurredAt: string;
}

export function createTransferCompletedPayload(
  transferId: string,
  occurredAt: Date,
): TransferCompletedPayload {
  if (
    !UUID_PATTERN.test(transferId) ||
    !Number.isFinite(occurredAt.getTime())
  ) {
    throw new Error('Invalid transfer completion event');
  }
  return {
    eventType: TRANSFER_COMPLETED_TYPE,
    eventVersion: TRANSFER_COMPLETED_VERSION,
    eventId: randomUUID(),
    transferId,
    occurredAt: occurredAt.toISOString(),
  };
}

export function parseTransferCompletedPayload(
  value: unknown,
): TransferCompletedPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid transfer completion event');
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (
    keys.length !== 5 ||
    !['eventType', 'eventVersion', 'eventId', 'transferId', 'occurredAt'].every(
      (key) => key in payload,
    ) ||
    payload.eventType !== TRANSFER_COMPLETED_TYPE ||
    payload.eventVersion !== TRANSFER_COMPLETED_VERSION ||
    typeof payload.eventId !== 'string' ||
    !UUID_PATTERN.test(payload.eventId) ||
    typeof payload.transferId !== 'string' ||
    !UUID_PATTERN.test(payload.transferId) ||
    typeof payload.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.occurredAt)) ||
    new Date(payload.occurredAt).toISOString() !== payload.occurredAt
  ) {
    throw new Error('Invalid transfer completion event');
  }
  return payload as unknown as TransferCompletedPayload;
}
