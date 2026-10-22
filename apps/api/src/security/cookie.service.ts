import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

import { EnvironmentVariables } from '../config/environment';
import { IssuedTokens } from '../auth/auth.types';

@Injectable()
export class CookieService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  get accessName(): string {
    return this.secure ? '__Host-ledgerflow_access' : 'ledgerflow_access';
  }

  get refreshName(): string {
    return this.secure ? '__Host-ledgerflow_refresh' : 'ledgerflow_refresh';
  }

  readAccess(request: Request): string | undefined {
    return this.read(request, this.accessName);
  }

  readRefresh(request: Request): string | undefined {
    return this.read(request, this.refreshName);
  }

  set(response: Response, tokens: IssuedTokens): void {
    response.cookie(this.accessName, tokens.accessToken, {
      ...this.options,
      maxAge:
        this.config.get('AUTH_ACCESS_TOKEN_TTL_SECONDS', { infer: true }) *
        1000,
    });
    response.cookie(this.refreshName, tokens.refreshToken, {
      ...this.options,
      maxAge:
        this.config.get('AUTH_REFRESH_TOKEN_TTL_SECONDS', { infer: true }) *
        1000,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.accessName, this.options);
    response.clearCookie(this.refreshName, this.options);
  }

  private get secure(): boolean {
    return this.config.get('AUTH_COOKIE_SECURE', { infer: true });
  }

  private get options(): CookieOptions {
    return {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.secure,
    };
  }

  private read(request: Request, name: string): string | undefined {
    const cookies: unknown = request.cookies;
    if (
      typeof cookies !== 'object' ||
      cookies === null ||
      Array.isArray(cookies)
    ) {
      return undefined;
    }
    const value: unknown = (cookies as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : undefined;
  }
}
