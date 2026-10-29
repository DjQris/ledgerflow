import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetadataDto {
  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 20 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  total!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  totalPages!: number;
}
