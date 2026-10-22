import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthenticatedRequest } from '../auth/guards/authentication.guard';
import { CookieService } from './cookie.service';
import { CSRF_MODE_KEY, CsrfMode } from './csrf-mode.decorator';
import { CsrfService } from './csrf.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly csrf: CsrfService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
      return true;
    const mode = this.reflector.get<CsrfMode>(
      CSRF_MODE_KEY,
      context.getHandler(),
    );
    if (mode === 'exempt') return true;

    let sessionId = request.authenticatedSessionId;
    if (mode === 'refresh' || mode === 'logout') {
      sessionId = await this.sessions.findRefreshSessionId(
        this.cookies.readRefresh(request),
      );
      if (!sessionId && mode === 'logout') {
        try {
          const access = this.cookies.readAccess(request);
          sessionId = this.tokens.verifyAccessToken(access).sid;
          await this.sessions.authenticate(access);
        } catch {
          // No active session remains; the logout handler may safely clear cookies.
          sessionId = undefined;
        }
      }
      if (!sessionId) return true; // Invalid credentials are rejected by the handler.
    }
    if (!sessionId) return false;
    this.csrf.assertValid(sessionId, request.get('x-csrf-token'));
    return true;
  }
}
