import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../config/environment';

@Injectable()
export class LocalSimulationGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const environment = this.config.get('NODE_ENV', { infer: true });
    const request = context.switchToHttp().getRequest<{
      socket?: { remoteAddress?: string };
    }>();
    const address = request.socket?.remoteAddress;
    const isLoopback =
      address === '127.0.0.1' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1';

    if (
      (environment !== 'development' && environment !== 'test') ||
      !isLoopback
    ) {
      throw new ForbiddenException(
        'Transfer simulation is available only from local development',
      );
    }
    return true;
  }
}
