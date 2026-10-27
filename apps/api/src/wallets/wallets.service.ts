import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { serializeMinorUnits } from '../common/money/minor-units';
import {
  LedgerAccountType,
  LedgerTransactionStatus,
  TransferStatus,
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

    const filters: Prisma.LedgerEntryWhereInput[] = [];
    if (query.from || query.to) {
      filters.push({
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to
            ? {
                lte: new Date(
                  /^\d{4}-\d{2}-\d{2}$/.test(query.to)
                    ? `${query.to}T23:59:59.999Z`
                    : query.to,
                ),
              }
            : {}),
        },
      });
    }
    if (query.reference) {
      const referenceMatches: Prisma.LedgerEntryWhereInput[] = [
        {
          transaction: {
            externalReference: {
              contains: query.reference,
              mode: 'insensitive',
            },
          },
        },
      ];
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          query.reference,
        )
      ) {
        referenceMatches.push({ transaction: { id: query.reference } });
      }
      filters.push({
        OR: referenceMatches,
      });
    }
    if (query.status) {
      const ledgerStatus = Object.values(LedgerTransactionStatus).find(
        (value) => value === query.status,
      );
      const transferStatus = Object.values(TransferStatus).find(
        (value) => value === query.status,
      );
      if (ledgerStatus) filters.push({ transaction: { status: ledgerStatus } });
      else if (transferStatus)
        filters.push({
          transaction: { transfer: { is: { status: transferStatus } } },
        });
    }
    if (query.direction === 'INCOMING')
      filters.push({ amountMinor: { gt: 0n } });
    if (query.direction === 'OUTGOING')
      filters.push({ amountMinor: { lt: 0n } });
    if (query.direction === 'NEUTRAL') filters.push({ amountMinor: 0n });

    const where = {
      accountId: wallet.ledgerAccount.id,
      ...(filters.length ? { AND: filters } : {}),
    } satisfies Prisma.LedgerEntryWhereInput;

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        include: {
          account: { select: { walletId: true } },
          transaction: {
            include: {
              transfer: {
                select: {
                  sourceWalletId: true,
                  destinationWalletId: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: query.sort }, { id: query.sort }],
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

  async getTransactionDetailsForUser(id: string, user: AuthenticatedUser) {
    const transaction = await this.prisma.ledgerTransaction.findFirst({
      include: {
        entries: {
          include: { account: { include: { wallet: true } } },
          where: { account: { wallet: { userId: user.id } } },
        },
        transfer: {
          select: {
            amountMinor: true,
            destinationWalletId: true,
            sourceWalletId: true,
            status: true,
          },
        },
      },
      where: {
        id,
        entries: { some: { account: { wallet: { userId: user.id } } } },
      },
    });
    if (!transaction || transaction.entries.length === 0)
      throw new NotFoundException('Transaction not found');
    const ownedEntry = transaction.entries[0];
    return {
      amountMinor: serializeMinorUnits(
        transaction.transfer?.amountMinor ??
          (ownedEntry.amountMinor < 0n
            ? -ownedEntry.amountMinor
            : ownedEntry.amountMinor),
      ),
      createdAt: ownedEntry.createdAt.toISOString(),
      currency: transaction.currency,
      description: transaction.transfer ? null : ownedEntry.description,
      destinationWalletId: transaction.transfer?.destinationWalletId ?? null,
      externalReference: transaction.externalReference,
      id: transaction.id,
      postedAt: transaction.postedAt?.toISOString() ?? null,
      sourceWalletId: transaction.transfer?.sourceWalletId ?? null,
      status: transaction.transfer?.status ?? transaction.status,
      type: transaction.type,
      walletId: ownedEntry.account.walletId,
    };
  }

  private findWalletRecord(where: Prisma.WalletWhereUniqueInput) {
    return this.prisma.wallet.findUnique({
      include: WALLET_WITH_ACCOUNT,
      where,
    });
  }
}
