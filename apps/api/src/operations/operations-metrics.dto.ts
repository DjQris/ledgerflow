import { ApiProperty } from '@nestjs/swagger';

export class OperationsDailyMetricDto {
  @ApiProperty({ example: '2026-10-27' })
  date!: string;

  @ApiProperty()
  completedCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiProperty({ example: '500000' })
  completedMinor!: string;
}

export class OperationsActivityDto {
  @ApiProperty()
  action!: string;

  @ApiProperty()
  entityType!: string;

  @ApiProperty()
  outcome!: string;

  @ApiProperty()
  actorType!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class OperationsMetricsDto {
  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;

  @ApiProperty({ example: 'UTC' })
  timeZone!: 'UTC';

  @ApiProperty()
  completedCount!: number;

  @ApiProperty({ example: '1250000' })
  completedMinor!: string;

  @ApiProperty()
  recordedFailedTransferCount!: number;

  @ApiProperty()
  registeredUsers!: number;

  @ApiProperty()
  pendingRetries!: number;

  @ApiProperty()
  pendingOutboxEvents!: number;

  @ApiProperty({ type: [OperationsDailyMetricDto] })
  daily!: OperationsDailyMetricDto[];

  @ApiProperty({ type: [OperationsActivityDto] })
  recentActivity!: OperationsActivityDto[];
}
