import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { SessionService } from '../security/session.service';
import { TokenService } from '../security/token.service';
import { AuthenticatedUser, IssuedTokens } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserProfileDto } from './dto/user-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterDto): Promise<UserProfileDto> {
    this.tokens.assertConfigured();
    const email = this.normalizeEmail(input.email);
    if (
      !isEmail(email) ||
      email.length > 254 ||
      email.endsWith('@ledgerflow.invalid')
    ) {
      throw new BadRequestException('A valid customer email is required');
    }
    const passwordHash = await this.passwords.hash(input.password);

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            email,
            passwordHash,
            role: UserRole.CUSTOMER,
            status: UserStatus.ACTIVE,
          },
        });
        await this.audit.recordSucceeded(transaction, {
          action: 'customer_registered',
          actorId: created.id,
          actorType: 'user',
          entityId: created.id,
          entityType: 'user',
        });
        return created;
      });
      return UserProfileDto.fromUser(user);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.audit.recordRejected({
          action: 'registration_rejected',
          actorType: 'unknown',
          entityId: randomUUID(),
          entityType: 'auth_attempt',
          metadata: { reason: 'DUPLICATE_ACCOUNT' },
        });
        throw new ConflictException('Account already exists');
      }
      throw error;
    }
  }

  async login(input: LoginDto): Promise<{
    profile: UserProfileDto;
    tokens: IssuedTokens;
  }> {
    this.tokens.assertConfigured();
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    let validPassword = false;
    try {
      this.passwords.validate(input.password);
      if (
        user?.status === UserStatus.ACTIVE &&
        typeof user.passwordHash === 'string'
      ) {
        validPassword = await this.passwords.verify(
          input.password,
          user.passwordHash,
        );
      } else {
        await this.passwords.verifyAgainstDummy(input.password);
      }
    } catch {
      await this.passwords.verifyAgainstDummy(input.password);
    }

    if (!user || !validPassword || user.status !== UserStatus.ACTIVE) {
      await this.audit.recordRejected({
        action: 'login_rejected',
        actorType: 'unknown',
        entityId: randomUUID(),
        entityType: 'auth_attempt',
        metadata: { reason: 'INVALID_CREDENTIALS' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const profile: AuthenticatedUser = {
      email: user.email,
      id: user.id,
      role: user.role,
      status: user.status,
    };
    const tokens = await this.sessions.start(profile);
    return { profile: UserProfileDto.fromUser(profile), tokens };
  }

  refresh(rawRefreshToken: string | undefined): Promise<IssuedTokens> {
    return this.sessions.rotate(rawRefreshToken);
  }

  logout(
    accessToken: string | undefined,
    refreshToken: string | undefined,
  ): Promise<void> {
    return this.sessions.logout(accessToken, refreshToken);
  }

  private normalizeEmail(value: string): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }
}
