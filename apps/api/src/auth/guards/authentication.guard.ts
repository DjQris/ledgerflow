import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../../access-control/decorators/public.decorator';
import { CookieService } from '../../security/cookie.service';
import { SessionService } from '../../security/session.service';
import { AuthenticatedUser } from '../auth.types';

export interface AuthenticatedRequest extends Request {
  authenticatedUser?: AuthenticatedUser;
  authenticatedSessionId?: string;
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = this.cookies.readAccess(request);
    if (!accessToken)
      throw new UnauthorizedException('Authentication required');
    const user = await this.sessions.authenticate(accessToken);
    request.authenticatedUser = user;
    request.authenticatedSessionId = user.sessionId;
    return true;
  }
}
