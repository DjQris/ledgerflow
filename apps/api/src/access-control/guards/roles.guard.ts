import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../../audit/audit.service';
import { AuthenticatedRequest } from '../../auth/guards/authentication.guard';
import { UserRole } from '../../generated/prisma/enums';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      targets,
    );
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authenticatedUser;
    if (!user || !allowed?.includes(user.role)) {
      if (user) {
        await this.audit.recordRejected({
          action: 'access_denied',
          actorId: user.id,
          actorType: 'user',
          entityId: randomUUID(),
          entityType: 'authorization_attempt',
          metadata: { reason: 'ROLE_DENIED' },
        });
      }
      throw new ForbiddenException('Access denied');
    }
    return true;
  }
}
