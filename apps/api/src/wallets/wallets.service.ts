import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  LedgerAccountType,
  LedgerTransactionStatus,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { NGN_CURRENCY } from '../ledger/ledger.constants';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import {
  WalletTransactionHistoryDto,
  WalletTransactionResponseDto,
} from './dto/wallet-transaction-history.dto';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';

const WALLET_WITH_ACCOUNT = {
  ledgerAccount: true,
} satisfies Prisma.WalletInclude;

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  async create(input: CreateWalletDto): Promise<WalletResponseDto> {
    const walletId = randomUUID();

    try {
      const wallet = await this.prisma.$transaction(async (transaction) => {
        const userId = await this.users.provisionForSimulatedWallet(
          transaction,
          walletId,
        );
        const createdWallet = await transaction.wallet.create({
          data: {
            currency: NGN_CURRENCY,
            id: walletId,
            ledgerAccount: {
              create: {
                cachedBalanceMinor: 0n,
                code: `WALLET_${walletId}`,
                currency: NGN_CURRENCY,
                name: `Wallet ledger for ${input.ownerReference}`,
                type: LedgerAccountType.WALLET,
              },
            },
            ownerReference: input.ownerReference,
            userId,
          },
          include: WALLET_WITH_ACCOUNT,
        });

        await this.audit.recordSucceeded(transaction, {
          action: 'wallet_created',
          actorId: input.ownerReference,
          actorType: 'simulated_owner',
          entityId: createdWallet.id,
          entityType: 'wallet',
        });

        return createdWallet;
      });

      return WalletResponseDto.fromRecord(wallet);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A wallet already exists for ${input.ownerReference}`,
        );
      }

      throw error;
    }
  }

  async findAll(): Promise<WalletResponseDto[]> {
    const wallets = await this.prisma.wallet.findMany({
      include: WALLET_WITH_ACCOUNT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return wallets.map((wallet) => WalletResponseDto.fromRecord(wallet));
  }

  async createForCustomer(user: AuthenticatedUser): Promise<WalletResponseDto> {
    if (user.role !== UserRole.CUSTOMER || user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Access denied');
    }
    const id = randomUUID();
    try {
      const wallet = await this.prisma.$transaction(async (transaction) => {
        const owner = await transaction.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "users"
          WHERE "id" = ${user.id}::uuid AND "status" = 'active'
          FOR UPDATE
        `;
        if (owner.length !== 1) throw new ForbiddenException('Access denied');
        const created = await transaction.wallet.create({
          data: {
            currency: NGN_CURRENCY,
            id,
            ledgerAccount: {
              create: {
                cachedBalanceMinor: 0n,
                code: `WALLET_${id}`,
                currency: NGN_CURRENCY,
                name: `Customer wallet ${id}`,
                type: LedgerAccountType.WALLET,
              },
            },
            ownerReference: `customer-${user.id}`,
            userId: user.id,
          },
          include: WALLET_WITH_ACCOUNT,
        });
        await this.audit.recordSucceeded(transaction, {
          action: 'wallet_created',
          actorId: user.id,
          actorType: 'user',
          entityId: id,
          entityType: 'wallet',
        });
        return created;
      });
      return WalletResponseDto.fromRecord(wallet);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Customer already has a wallet');
      }
      throw error;
    }
  }

  async findAllForUser(user: AuthenticatedUser): Promise<WalletResponseDto[]> {
    const wallets = await this.prisma.wallet.findMany({
      include: WALLET_WITH_ACCOUNT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: user.role === UserRole.CUSTOMER ? { userId: user.id } : {},
    });
    return wallets.map((wallet) => WalletResponseDto.fromRecord(wallet));
  }

  async findOneForUser(
    id: string,
    user: AuthenticatedUser,
  ): Promise<WalletResponseDto> {
    const wallet = await this.findWalletRecord({ id });
    if (!wallet) throw new NotFoundException(`Wallet ${id} was not found`);
    if (user.role === UserRole.CUSTOMER && wallet.userId !== user.id) {
      await this.audit.recordRejected({
        action: 'access_denied',
        actorId: user.id,
        actorType: 'user',
        entityId: wallet.id,
        entityType: 'wallet',
        metadata: { reason: 'NOT_OWNER' },
      });
      throw new ForbiddenException('Access denied');
    }
    return WalletResponseDto.fromRecord(wallet);
  }

  async getTransactionsForUser(
    id: string,
    query: WalletTransactionsQueryDto,
    user: AuthenticatedUser,
  ): Promise<WalletTransactionHistoryDto> {
    await this.findOneForUser(id, user);
    return this.getTransactions(id, query);
  }

  async findOne(id: string): Promise<WalletResponseDto> {
    const wallet = await this.findWalletRecord({ id });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${id} was not found`);
    }

    return WalletResponseDto.fromRecord(wallet);
  }

  async findByOwnerReference(
    ownerReference: string,
  ): Promise<WalletResponseDto | null> {
    const wallet = await this.findWalletRecord({ ownerReference });

    return wallet ? WalletResponseDto.fromRecord(wallet) : null;
  }

  async getTransactions(
    id: string,
    query: WalletTransactionsQueryDto,
  ): Promise<WalletTransactionHistoryDto> {
    const wallet = await this.findWalletRecord({ id });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${id} was not found`);
    }

    if (!wallet.ledgerAccount) {
      throw new Error(`Wallet ${wallet.id} has no ledger account`);
    }

    const where = {
      accountId: wallet.ledgerAccount.id,
      transaction: { status: LedgerTransactionStatus.POSTED },
    } satisfies Prisma.LedgerEntryWhereInput;

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        include: {
          account: { select: { walletId: true } },
          transaction: {
            include: {
              transfer: {
                select: { sourceWalletId: true, destinationWalletId: true },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
    ]);

    return {
      data: entries.map((entry) =>
        WalletTransactionResponseDto.fromRecord(entry),
      ),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  private findWalletRecord(where: Prisma.WalletWhereUniqueInput) {
    return this.prisma.wallet.findUnique({
      include: WALLET_WITH_ACCOUNT,
      where,
    });
  }
}
