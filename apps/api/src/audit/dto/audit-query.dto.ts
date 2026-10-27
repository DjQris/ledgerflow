import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { AuditOutcome } from '../../generated/prisma/enums';
import { AuditEventResponseDto } from './audit-event-response.dto';

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class AuditSearchQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 10000, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional({ enum: AuditOutcome })
  @IsOptional()
  @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
}

export class AuditEventPageDto {
  @ApiProperty({ type: [AuditEventResponseDto] })
  data!: AuditEventResponseDto[];

  @ApiProperty({ example: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
  pagination!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
