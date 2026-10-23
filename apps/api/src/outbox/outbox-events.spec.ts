import { randomUUID } from 'node:crypto';

import {
  createTransferCompletedPayload,
  parseTransferCompletedPayload,
} from './outbox-events';

describe('versioned outbox payloads', () => {
  it('creates a minimal transfer completion event', () => {
    const transferId = randomUUID();
    const payload = createTransferCompletedPayload(
      transferId,
      new Date('2026-10-23T10:00:00.000Z'),
    );
    expect(Object.keys(payload).sort()).toEqual([
      'eventId',
      'eventType',
      'eventVersion',
      'occurredAt',
      'transferId',
    ]);
    expect(parseTransferCompletedPayload(payload)).toEqual(payload);
  });

  it('rejects unknown fields and malformed versions', () => {
    const payload = createTransferCompletedPayload(randomUUID(), new Date());
    expect(() =>
      parseTransferCompletedPayload({
        ...payload,
        email: 'private@example.com',
      }),
    ).toThrow();
    expect(() =>
      parseTransferCompletedPayload({ ...payload, eventVersion: 2 }),
    ).toThrow();
    expect(() =>
      parseTransferCompletedPayload({ ...payload, transferId: 'invalid' }),
    ).toThrow();
  });
});
