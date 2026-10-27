import { ApiProperty } from '@nestjs/swagger';

import { serializeMinorUnits } from '../../common/money/minor-units';
import {
  LedgerTransactionStatus,
  LedgerTransactionType,
} from '../../generated/prisma/enums';

export interface WalletEntryForResponse {
  amountMinor: bigint;
  account: { walletId: string | null };
  createdAt: Date;
  description: string | null;
  id: string;
  transaction: {
    externalReference: string | null;
    id: string;
    postedAt: Date | null;
    status: LedgerTransactionStatus;
    type: LedgerTransactionType;
    transfer: { sourceWalletId: string; destinationWalletId: string } | null;
  };
}

export class WalletTransactionResponseDto {
  @ApiProperty({ example: '500000' })
  amountMinor!: string;

  @ApiProperty({ example: '2026-10-21T17:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['INCOMING', 'OUTGOING', 'NEUTRAL'] })
  direction!: 'INCOMING' | 'OUTGOING' | 'NEUTRAL';

  @ApiProperty({ nullable: true })
  externalReference!: string | null;

  @ApiProperty({ example: '5ad244aa-f5f1-4560-8a5b-4a4be9684e58' })
  id!: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  counterpartyWalletId!: string | null;

  @ApiProperty({ example: '2026-10-21T17:00:00.000Z', nullable: true })
  postedAt!: string | null;

  @ApiProperty({ enum: LedgerTransactionStatus })
  status!: LedgerTransactionStatus;

  @ApiProperty({ example: '7f6827f9-9a4c-435e-b9cb-1bb62ae2165a' })
  transactionId!: string;

  @ApiProperty({ enum: LedgerTransactionType })
  type!: LedgerTransactionType;

  static fromRecord(
    record: WalletEntryForResponse,
  ): WalletTransactionResponseDto {
    const outgoing = record.amountMinor < 0n;
    const incoming = record.amountMinor > 0n;
    const transfer = record.transaction.transfer;
    const walletId = record.account.walletId;
    return {
      amountMinor: serializeMinorUnits(record.amountMinor),
      createdAt: record.createdAt.toISOString(),
      description: record.description,
      direction: outgoing ? 'OUTGOING' : incoming ? 'INCOMING' : 'NEUTRAL',
      externalReference: record.transaction.externalReference,
      id: record.id,
      counterpartyWalletId:
        transfer && walletId === transfer.sourceWalletId
          ? transfer.destinationWalletId
          : transfer && walletId === transfer.destinationWalletId
            ? transfer.sourceWalletId
            : null,
      postedAt: record.transaction.postedAt?.toISOString() ?? null,
      status: record.transaction.status,
      transactionId: record.transaction.id,
      type: record.transaction.type,
    };
  }
}

export class PaginationMetadataDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

export class WalletTransactionHistoryDto {
  @ApiProperty({ type: [WalletTransactionResponseDto] })
  data!: WalletTransactionResponseDto[];

  @ApiProperty({ type: PaginationMetadataDto })
  pagination!: PaginationMetadataDto;
}
