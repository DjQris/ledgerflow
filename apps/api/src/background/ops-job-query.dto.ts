import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const FAILED_JOB_STATUSES = [
  'retrying',
  'dead_letter',
  'retry_pending',
  'resolved',
] as const;
export const FAILED_JOB_SOURCES = ['dispatcher', 'worker'] as const;
export const FAILED_JOB_EVENT_TYPES = ['transfer.completed'] as const;

export class OpsJobQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ enum: FAILED_JOB_STATUSES })
  @IsOptional()
  @IsIn(FAILED_JOB_STATUSES)
  status?: (typeof FAILED_JOB_STATUSES)[number];

  @ApiPropertyOptional({ enum: FAILED_JOB_SOURCES })
  @IsOptional()
  @IsIn(FAILED_JOB_SOURCES)
  source?: (typeof FAILED_JOB_SOURCES)[number];

  @ApiPropertyOptional({ enum: FAILED_JOB_EVENT_TYPES })
  @IsOptional()
  @IsIn(FAILED_JOB_EVENT_TYPES)
  eventType?: (typeof FAILED_JOB_EVENT_TYPES)[number];
}
