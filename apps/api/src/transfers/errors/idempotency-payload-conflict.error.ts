import { ConflictException } from '@nestjs/common';

export class IdempotencyPayloadConflictError extends ConflictException {
  constructor() {
    super('Idempotency-Key is already bound to a different transfer request');
  }
}
