import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export const POSITIVE_MINOR_UNITS_PATTERN = /^[1-9]\d*$/;

export class TransferCommand {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  destinationWalletId!: string;

  @ApiProperty({ example: '1000000', description: 'Positive amount in kobo' })
  @IsString()
  @Matches(POSITIVE_MINOR_UNITS_PATTERN, {
    message: 'amountMinor must be a canonical positive integer string',
  })
  amountMinor!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sourceWalletId!: string;
}
