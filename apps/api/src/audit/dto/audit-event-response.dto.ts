import { ApiProperty } from '@nestjs/swagger';
import { AuditOutcome } from '../../generated/prisma/enums';

export class AuditEventResponseDto {
  @ApiProperty({ example: 'transfer_completed' })
  action!: string;

  @ApiProperty({ nullable: true, example: 'test-ada' })
  actorId!: string | null;

  @ApiProperty({ nullable: true, example: 'simulated_owner' })
  actorType!: string | null;

  @ApiProperty({ format: 'uuid' })
  entityId!: string;

  @ApiProperty({ example: 'transfer' })
  entityType!: string;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, type: Object })
  metadata!: unknown;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ enum: AuditOutcome })
  outcome!: AuditOutcome;
}
