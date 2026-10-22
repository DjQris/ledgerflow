import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { Prisma } from '../generated/prisma/client';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<UserProfileDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return users.map((user) => UserProfileDto.fromUser(user));
  }

  async changeRole(
    actor: AuthenticatedUser,
    targetId: string,
    role: UserRole,
  ): Promise<UserProfileDto> {
    if (actor.id === targetId) {
      throw new ForbiddenException(
        'Administrators cannot change their own role',
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      // Serialize all role/status changes that could affect the admin quorum.
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(28172, 2)::text AS locked`;
      await this.assertActorAdmin(transaction, actor.id);
      const target = await transaction.user.findUnique({
        where: { id: targetId },
      });
      if (!target) throw new NotFoundException('User not found');
      if (target.role === role) return UserProfileDto.fromUser(target);
      if (
        target.role === UserRole.ADMIN &&
        target.status === UserStatus.ACTIVE
      ) {
        await this.assertAnotherActiveAdmin(transaction, targetId);
      }
      const updated = await transaction.user.update({
        data: { role },
        where: { id: targetId },
      });
      await this.audit.recordSucceeded(transaction, {
        action: 'account_role_changed',
        actorId: actor.id,
        actorType: 'user',
        entityId: targetId,
        entityType: 'user',
        metadata: { from: target.role, to: role },
      });
      return UserProfileDto.fromUser(updated);
    });
  }

  async changeStatus(
    actor: AuthenticatedUser,
    targetId: string,
    status: UserStatus,
  ): Promise<UserProfileDto> {
    if (actor.id === targetId) {
      throw new ForbiddenException(
        'Administrators cannot change their own status',
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(28172, 2)::text AS locked`;
      await this.assertActorAdmin(transaction, actor.id);
      const target = await transaction.user.findUnique({
        where: { id: targetId },
      });
      if (!target) throw new NotFoundException('User not found');
      if (target.status === status) return UserProfileDto.fromUser(target);
      if (target.role === UserRole.ADMIN && status === UserStatus.SUSPENDED) {
        await this.assertAnotherActiveAdmin(transaction, targetId);
      }
      const updated = await transaction.user.update({
        data: { status },
        where: { id: targetId },
      });
      if (status === UserStatus.SUSPENDED) {
        const now = new Date();
        const sessions = await transaction.authSession.findMany({
          select: { id: true },
          where: { userId: targetId, revokedAt: null },
        });
        await transaction.authSession.updateMany({
          data: { revokedAt: now },
          where: { userId: targetId, revokedAt: null },
        });
        await transaction.refreshToken.updateMany({
          data: { revokedAt: now },
          where: {
            sessionId: { in: sessions.map((session) => session.id) },
            revokedAt: null,
          },
        });
      }
      await this.audit.recordSucceeded(transaction, {
        action:
          status === UserStatus.SUSPENDED
            ? 'account_suspended'
            : 'account_reactivated',
        actorId: actor.id,
        actorType: 'user',
        entityId: targetId,
        entityType: 'user',
      });
      return UserProfileDto.fromUser(updated);
    });
  }

  private async assertAnotherActiveAdmin(
    transaction: Prisma.TransactionClient,
    targetId: string,
  ): Promise<void> {
    const count = await transaction.user.count({
      where: {
        id: { not: targetId },
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    if (count === 0) {
      throw new ConflictException(
        'The last active administrator cannot be removed',
      );
    }
  }

  private async assertActorAdmin(
    transaction: Prisma.TransactionClient,
    actorId: string,
  ): Promise<void> {
    const actor = await transaction.user.findUnique({ where: { id: actorId } });
    if (actor?.role !== UserRole.ADMIN || actor.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Access denied');
    }
  }
}
