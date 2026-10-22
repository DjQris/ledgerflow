import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { EnvironmentVariables } from '../config/environment';

export interface AccessClaims {
  exp: number;
  sub: string;
  sid: string;
}

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;

@Injectable()
export class TokenService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly jwt: JwtService,
  ) {}

  assertConfigured(): string {
    const key = this.config.get('AUTH_SIGNING_KEY', { infer: true });
    if (!key) {
      throw new ServiceUnavailableException('Authentication is not configured');
    }
    return key;
  }

  issueAccessToken(userId: string, sessionId: string): string {
    return this.jwt.sign(
      { sid: sessionId, sub: userId },
      {
        algorithm: 'HS256',
        audience: this.config.get('AUTH_AUDIENCE', { infer: true }),
        expiresIn: this.config.get('AUTH_ACCESS_TOKEN_TTL_SECONDS', {
          infer: true,
        }),
        issuer: this.config.get('AUTH_ISSUER', { infer: true }),
        jwtid: randomUUID(),
        secret: this.assertConfigured(),
      },
    );
  }

  verifyAccessToken(token: string | undefined): AccessClaims {
    const secret = this.assertConfigured();
    if (!token || token.length > 4096) {
      throw new UnauthorizedException('Authentication required');
    }
    try {
      const claims = this.jwt.verify<AccessClaims>(token, {
        algorithms: ['HS256'],
        audience: this.config.get('AUTH_AUDIENCE', { infer: true }),
        issuer: this.config.get('AUTH_ISSUER', { infer: true }),
        secret,
      });
      if (
        !isUUID(claims.sub, '4') ||
        !isUUID(claims.sid, '4') ||
        typeof claims.exp !== 'number' ||
        !Number.isFinite(claims.exp)
      ) {
        throw new Error('Invalid access claims');
      }
      return { exp: claims.exp, sid: claims.sid, sub: claims.sub };
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }

  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  isRefreshToken(value: unknown): value is string {
    return typeof value === 'string' && REFRESH_TOKEN_PATTERN.test(value);
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
