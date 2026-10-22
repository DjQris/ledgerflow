import { ApiProperty } from '@nestjs/swagger';

import { TransferStatus } from '../../generated/prisma/enums';
import { TransferResult } from './transfer-result.dto';

export class TransferResponseDto implements TransferResult {
  @ApiProperty({ example: '1000000', description: 'Amount in kobo' })
  amountMinor!: string;

  @ApiProperty({ format: 'date-time' })
  completedAt!: string;

  @ApiProperty({ example: '1000000' })
  destinationBalanceMinor!: string;

  @ApiProperty({ format: 'uuid' })
  destinationWalletId!: string;

  @ApiProperty({ format: 'uuid' })
  journalId!: string;

  @ApiProperty({ example: '4000000' })
  sourceBalanceMinor!: string;

  @ApiProperty({ format: 'uuid' })
  sourceWalletId!: string;

  @ApiProperty({ enum: TransferStatus })
  status!: TransferStatus;

  @ApiProperty({ format: 'uuid' })
  transferId!: string;
}

export class TransferInspectionDto {
  @ApiProperty({ example: '1000000' })
  amountMinor!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiProperty({ format: 'uuid' })
  destinationWalletId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  journalId!: string | null;

  @ApiProperty({ format: 'uuid' })
  sourceWalletId!: string;

  @ApiProperty({ enum: TransferStatus })
  status!: TransferStatus;

  @ApiProperty({ format: 'uuid' })
  transferId!: string;
}
