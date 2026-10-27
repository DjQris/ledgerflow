import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class WalletTransactionsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter entries created on or after this ISO date/time.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter entries created on or before this ISO date/time.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['INCOMING', 'OUTGOING', 'NEUTRAL'] })
  @IsOptional()
  @IsIn(['INCOMING', 'OUTGOING', 'NEUTRAL'])
  direction?: 'INCOMING' | 'OUTGOING' | 'NEUTRAL';

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Case-insensitive substring of the transaction reference.',
  })
  @IsOptional()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({
    enum: ['PENDING', 'POSTED', 'VOIDED', 'COMPLETED', 'FAILED', 'REVERSED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'POSTED', 'VOIDED', 'COMPLETED', 'FAILED', 'REVERSED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
