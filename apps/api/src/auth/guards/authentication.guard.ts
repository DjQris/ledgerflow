import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CookieService } from '../../security/cookie.service';
import { SessionService } from '../../security/session.service';
import { AuthenticatedUser } from '../auth.types';

export interface AuthenticatedRequest extends Request {
  authenticatedUser?: AuthenticatedUser;
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = this.cookies.readAccess(request);
    if (!accessToken)
      throw new UnauthorizedException('Authentication required');
    request.authenticatedUser = await this.sessions.authenticate(accessToken);
    return true;
  }
}
