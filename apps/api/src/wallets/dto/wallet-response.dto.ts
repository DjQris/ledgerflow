import { ApiProperty } from '@nestjs/swagger';

import { serializeMinorUnits } from '../../common/money/minor-units';
import { WalletStatus } from '../../generated/prisma/enums';

export interface WalletRecordForResponse {
  createdAt: Date;
  currency: string;
  id: string;
  ledgerAccount: { cachedBalanceMinor: bigint } | null;
  ownerReference: string;
  status: WalletStatus;
  updatedAt: Date;
}

export class WalletResponseDto {
  @ApiProperty({ example: '0' })
  balanceMinor!: string;

  @ApiProperty({ example: '2026-10-21T17:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({ example: '7c177354-8482-4fe5-a781-1174a9447b0e' })
  id!: string;

  @ApiProperty({ example: 'test-alice' })
  ownerReference!: string;

  @ApiProperty({ enum: WalletStatus, example: WalletStatus.ACTIVE })
  status!: WalletStatus;

  @ApiProperty({ example: '2026-10-21T17:00:00.000Z' })
  updatedAt!: string;

  static fromRecord(record: WalletRecordForResponse): WalletResponseDto {
    if (!record.ledgerAccount) {
      throw new Error(`Wallet ${record.id} has no ledger account`);
    }

    return {
      balanceMinor: serializeMinorUnits(
        record.ledgerAccount.cachedBalanceMinor,
      ),
      createdAt: record.createdAt.toISOString(),
      currency: record.currency,
      id: record.id,
      ownerReference: record.ownerReference,
      status: record.status,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
