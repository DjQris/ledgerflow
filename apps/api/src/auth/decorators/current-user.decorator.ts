import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticatedRequest } from '../guards/authentication.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authenticatedUser;
    if (!user) throw new UnauthorizedException('Authentication required');
    return user;
  },
);
