import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { EnvironmentVariables } from '../config/environment';
import { TokenService } from './token.service';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/;

@Injectable()
export class CsrfService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly tokens: TokenService,
  ) {}

  issueForAccess(accessToken: string): string {
    return this.issue(this.tokens.verifyAccessToken(accessToken).sid);
  }

  issue(sessionId: string): string {
    const nonce = randomBytes(32).toString('base64url');
    return `${nonce}.${this.mac(sessionId, nonce)}`;
  }

  assertValid(sessionId: string, value: unknown): void {
    if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
      throw new ForbiddenException('CSRF token required');
    }
    const [nonce, signature] = value.split('.');
    const expected = Buffer.from(this.mac(sessionId, nonce), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (!timingSafeEqual(expected, actual)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
  }

  private mac(sessionId: string, nonce: string): string {
    const key = this.config.get('AUTH_SIGNING_KEY', { infer: true });
    if (!key) throw new ForbiddenException('CSRF protection unavailable');
    return createHmac('sha256', key)
      .update(`ledgerflow:csrf:v1:${sessionId}:${nonce}`)
      .digest('hex');
  }
}
