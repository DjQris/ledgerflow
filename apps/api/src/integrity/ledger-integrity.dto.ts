import { ApiProperty } from '@nestjs/swagger';

export class LedgerIntegrityIssueDto {
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['journal', 'wallet'] }) resourceType!:
    'journal' | 'wallet';
  @ApiProperty() resourceId!: string;
  @ApiProperty({ type: Object }) detail!: Record<string, string>;
}

export class LedgerIntegrityReportDto {
  @ApiProperty({ format: 'uuid' }) reportId!: string;
  @ApiProperty({ format: 'date-time' }) checkedAt!: string;
  @ApiProperty() accountCount!: string;
  @ApiProperty() journalCount!: string;
  @ApiProperty() walletCount!: string;
  @ApiProperty() ok!: boolean;
  @ApiProperty({ type: [LedgerIntegrityIssueDto] })
  issues!: LedgerIntegrityIssueDto[];
}
