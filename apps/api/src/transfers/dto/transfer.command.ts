import { IsString, IsUUID, Matches } from 'class-validator';

export const POSITIVE_MINOR_UNITS_PATTERN = /^[1-9]\d*$/;

export class TransferCommand {
  @IsUUID('4')
  destinationWalletId!: string;

  @IsString()
  @Matches(POSITIVE_MINOR_UNITS_PATTERN, {
    message: 'amountMinor must be a canonical positive integer string',
  })
  amountMinor!: string;

  @IsUUID('4')
  sourceWalletId!: string;
}
