import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import {
  AuthenticatedSessionUser,
  AuthenticatedUser,
  IssuedTokens,
} from '../auth/auth.types';
import { EnvironmentVariables } from '../config/environment';
import { Prisma } from '../generated/prisma/client';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

interface LockedSessionRow {
  id: string;
}

interface ConsumedTokenRow {
  id: string;
}

type RotationResult =
  | { kind: 'success'; tokens: IssuedTokens }
  | { kind: 'invalid' }
  | { kind: 'reused' };

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly tokens: TokenService,
  ) {}

  async start(user: AuthenticatedUser): Promise<IssuedTokens> {
    this.tokens.assertConfigured();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        this.config.get('AUTH_REFRESH_TOKEN_TTL_SECONDS', { infer: true }) *
          1000,
    );
    const refreshToken = this.tokens.generateRefreshToken();

    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.authSession.create({
        data: {
          expiresAt,
          lastUsedAt: now,
          userId: user.id,
        },
      });
      await transaction.refreshToken.create({
        data: {
          expiresAt,
          sessionId: session.id,
          tokenHash: this.tokens.hashRefreshToken(refreshToken),
        },
      });
      await this.audit.recordSucceeded(transaction, {
        action: 'login_succeeded',
        actorId: user.id,
        actorType: 'user',
        entityId: session.id,
        entityType: 'auth_session',
      });
      return {
        accessToken: this.tokens.issueAccessToken(user.id, session.id),
        refreshToken,
      };
    });
  }

  async authenticate(
    accessToken: string | undefined,
  ): Promise<AuthenticatedSessionUser> {
    const claims = this.tokens.verifyAccessToken(accessToken);
    const session = await this.prisma.authSession.findUnique({
      include: { user: true },
      where: { id: claims.sid },
    });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Authentication required');
    }
    return { ...this.toAuthenticatedUser(session.user), sessionId: session.id };
  }

  async findRefreshSessionId(
    rawRefreshToken: string | undefined,
  ): Promise<string | undefined> {
    if (!this.tokens.isRefreshToken(rawRefreshToken)) return undefined;
    const record = await this.prisma.refreshToken.findUnique({
      select: { sessionId: true },
      where: { tokenHash: this.tokens.hashRefreshToken(rawRefreshToken) },
    });
    return record?.sessionId;
  }

  async rotate(rawRefreshToken: string | undefined): Promise<IssuedTokens> {
    this.tokens.assertConfigured();
    if (!this.tokens.isRefreshToken(rawRefreshToken)) {
      throw new UnauthorizedException('Authentication required');
    }
    const tokenHash = this.tokens.hashRefreshToken(rawRefreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      select: { id: true, sessionId: true },
      where: { tokenHash },
    });
    if (!record) {
      await this.recordRefreshRejection();
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.prisma.$transaction(
      async (transaction): Promise<RotationResult> => {
        const locked = await this.lockSession(transaction, record.sessionId);
        if (!locked) return { kind: 'invalid' };
        const session = await transaction.authSession.findUnique({
          include: { user: true },
          where: { id: record.sessionId },
        });
        if (!session) return { kind: 'invalid' };

        const now = new Date();
        const consumed = await transaction.$queryRaw<ConsumedTokenRow[]>`
          UPDATE "refresh_tokens"
          SET "used_at" = ${now}
          WHERE "id" = ${record.id}::uuid
            AND "used_at" IS NULL
            AND "revoked_at" IS NULL
            AND "expires_at" > ${now}
          RETURNING "id"
        `;
        if (consumed.length === 0) {
          const current = await transaction.refreshToken.findUnique({
            where: { id: record.id },
          });
          if (current?.usedAt) {
            await this.revokeInTransaction(transaction, session.id, now);
            await this.audit.recordRejectedInTransaction(transaction, {
              action: 'refresh_token_reuse_detected',
              actorId: session.userId,
              actorType: 'user',
              entityId: session.id,
              entityType: 'auth_session',
              metadata: { reason: 'TOKEN_REUSE' },
            });
            return { kind: 'reused' };
          }
          return { kind: 'invalid' };
        }

        if (
          session.revokedAt ||
          session.expiresAt.getTime() <= now.getTime() ||
          session.user.status !== UserStatus.ACTIVE
        ) {
          return { kind: 'invalid' };
        }

        const refreshToken = this.tokens.generateRefreshToken();
        const expiresAt = new Date(
          Math.min(
            session.expiresAt.getTime(),
            now.getTime() +
              this.config.get('AUTH_REFRESH_TOKEN_TTL_SECONDS', {
                infer: true,
              }) *
                1000,
          ),
        );
        await transaction.refreshToken.create({
          data: {
            expiresAt,
            parentTokenId: record.id,
            sessionId: session.id,
            tokenHash: this.tokens.hashRefreshToken(refreshToken),
          },
        });
        await transaction.authSession.update({
          data: { lastUsedAt: now },
          where: { id: session.id },
        });
        await this.audit.recordSucceeded(transaction, {
          action: 'refresh_token_rotated',
          actorId: session.userId,
          actorType: 'user',
          entityId: session.id,
          entityType: 'auth_session',
        });
        return {
          kind: 'success',
          tokens: {
            accessToken: this.tokens.issueAccessToken(
              session.userId,
              session.id,
            ),
            refreshToken,
          },
        };
      },
      { maxWait: 5_000, timeout: 10_000 },
    );

    if (result.kind !== 'success') {
      if (result.kind === 'invalid') await this.recordRefreshRejection();
      throw new UnauthorizedException('Authentication required');
    }
    return result.tokens;
  }

  async logout(
    accessToken: string | undefined,
    rawRefreshToken: string | undefined,
  ): Promise<void> {
    let sessionId: string | undefined;
    let userId: string | undefined;
    if (this.tokens.isRefreshToken(rawRefreshToken)) {
      const record = await this.prisma.refreshToken.findUnique({
        select: { sessionId: true },
        where: { tokenHash: this.tokens.hashRefreshToken(rawRefreshToken) },
      });
      sessionId = record?.sessionId;
    }
    if (!sessionId && accessToken) {
      try {
        const claims = this.tokens.verifyAccessToken(accessToken);
        sessionId = claims.sid;
        userId = claims.sub;
      } catch {
        // Invalid cookies are cleared without exposing token validity.
      }
    }
    if (!sessionId) return;

    await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lockSession(transaction, sessionId);
      if (!locked) return;
      const session = await transaction.authSession.findUnique({
        where: { id: sessionId },
      });
      if (
        !session ||
        session.revokedAt ||
        (userId && session.userId !== userId)
      ) {
        return;
      }
      await this.revokeInTransaction(transaction, session.id, new Date());
      await this.audit.recordSucceeded(transaction, {
        action: 'logout_succeeded',
        actorId: session.userId,
        actorType: 'user',
        entityId: session.id,
        entityType: 'auth_session',
      });
    });
  }

  private async lockSession(
    transaction: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<LockedSessionRow[]>`
      SELECT "id" FROM "auth_sessions"
      WHERE "id" = ${sessionId}::uuid FOR UPDATE
    `;
    return rows.length === 1;
  }

  private async revokeInTransaction(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await transaction.authSession.updateMany({
      data: { revokedAt: now },
      where: { id: sessionId, revokedAt: null },
    });
    await transaction.refreshToken.updateMany({
      data: { revokedAt: now },
      where: { revokedAt: null, sessionId },
    });
  }

  private async recordRefreshRejection(): Promise<void> {
    await this.audit.recordRejected({
      action: 'refresh_rejected',
      actorType: 'unknown',
      entityId: randomUUID(),
      entityType: 'auth_attempt',
      metadata: { reason: 'INVALID_REFRESH_TOKEN' },
    });
  }

  private toAuthenticatedUser(user: AuthenticatedUser): AuthenticatedUser {
    return {
      email: user.email,
      id: user.id,
      role: user.role,
      status: user.status,
    };
  }
}
