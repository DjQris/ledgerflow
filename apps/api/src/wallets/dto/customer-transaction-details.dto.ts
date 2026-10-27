import { ApiProperty } from '@nestjs/swagger';

export class CustomerTransactionDetailsDto {
  @ApiProperty({ example: '500000' })
  amountMinor!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  destinationWalletId!: string | null;

  @ApiProperty({ nullable: true })
  externalReference!: string | null;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  postedAt!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  sourceWalletId!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ format: 'uuid' })
  walletId!: string | null;
}
