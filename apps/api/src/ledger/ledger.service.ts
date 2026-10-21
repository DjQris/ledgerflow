import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { serializeMinorUnits } from '../common/money/minor-units';
import { EnvironmentVariables } from '../config/environment';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OpeningFundingResult } from './dto/opening-funding-result.dto';
import {
  NGN_CURRENCY,
  NGN_SYSTEM_FUNDING_ACCOUNT_CODE,
} from './ledger.constants';

interface DevelopmentOpeningFundingInput {
  amountMinor: bigint;
  externalReference: string;
  walletId: string;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async postDevelopmentOpeningFunding(
    input: DevelopmentOpeningFundingInput,
  ): Promise<OpeningFundingResult> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'production') {
      throw new ForbiddenException(
        'Development funding is disabled in production',
      );
    }

    if (input.amountMinor <= 0n) {
      throw new RangeError('Opening funding amount must be positive');
    }

    return this.prisma.$transaction(async (transaction) => {
      const wallet = await transaction.wallet.findUnique({
        include: { ledgerAccount: true },
        where: { id: input.walletId },
      });

      if (!wallet?.ledgerAccount) {
        throw new Error(`Wallet ${input.walletId} has no ledger account`);
      }

      if (wallet.currency !== NGN_CURRENCY) {
        throw new Error(`Wallet ${input.walletId} is not denominated in NGN`);
      }

      const existingJournal = await transaction.ledgerTransaction.findUnique({
        include: { entries: true },
        where: { externalReference: input.externalReference },
      });

      if (existingJournal) {
        const walletEntry = existingJournal.entries.find(
          (entry) => entry.accountId === wallet.ledgerAccount?.id,
        );

        if (
          existingJournal.status !== LedgerTransactionStatus.POSTED ||
          existingJournal.type !== LedgerTransactionType.OPENING_FUNDING ||
          existingJournal.currency !== NGN_CURRENCY ||
          walletEntry?.amountMinor !== input.amountMinor
        ) {
          throw new Error(
            `Opening funding reference ${input.externalReference} conflicts with an existing journal`,
          );
        }

        return {
          amountMinor: serializeMinorUnits(walletEntry.amountMinor),
          journalId: existingJournal.id,
          walletId: input.walletId,
        };
      }

      const systemAccount = await transaction.ledgerAccount.findUnique({
        where: { code: NGN_SYSTEM_FUNDING_ACCOUNT_CODE },
      });

      if (!systemAccount) {
        throw new Error('The NGN system funding account is missing');
      }

      const journal = await transaction.ledgerTransaction.create({
        data: {
          currency: NGN_CURRENCY,
          description: `Simulated opening funding for ${wallet.ownerReference}`,
          externalReference: input.externalReference,
          status: LedgerTransactionStatus.PENDING,
          type: LedgerTransactionType.OPENING_FUNDING,
        },
      });

      await transaction.ledgerEntry.createMany({
        data: [
          {
            accountId: systemAccount.id,
            amountMinor: -input.amountMinor,
            description: 'Simulated development funding source',
            transactionId: journal.id,
          },
          {
            accountId: wallet.ledgerAccount.id,
            amountMinor: input.amountMinor,
            description: 'Simulated development opening balance',
            transactionId: journal.id,
          },
        ],
      });

      await transaction.ledgerTransaction.update({
        data: { status: LedgerTransactionStatus.POSTED },
        where: { id: journal.id },
      });

      await transaction.auditEvent.create({
        data: {
          action: 'development_opening_funding_posted',
          actorId: 'development-seed',
          actorType: 'system',
          entityId: wallet.id,
          entityType: 'wallet',
          metadata: {
            amountMinor: serializeMinorUnits(input.amountMinor),
            externalReference: input.externalReference,
            journalId: journal.id,
          },
        },
      });

      return {
        amountMinor: serializeMinorUnits(input.amountMinor),
        journalId: journal.id,
        walletId: wallet.id,
      };
    });
  }
}
