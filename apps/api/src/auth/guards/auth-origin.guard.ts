import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { EnvironmentVariables } from '../../config/environment';

@Injectable()
export class AuthOriginGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const origin = request.get('origin');
    const fetchSite = request.get('sec-fetch-site');
    const expected = this.config.get('AUTH_ALLOWED_ORIGIN', { infer: true });

    if (
      (origin !== undefined && origin !== expected) ||
      fetchSite === 'cross-site' ||
      (fetchSite !== undefined && origin === undefined)
    ) {
      throw new ForbiddenException('Request origin is not allowed');
    }
    return true;
  }
}
