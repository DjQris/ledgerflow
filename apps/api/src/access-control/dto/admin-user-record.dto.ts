import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../generated/prisma/enums';
import { PaginationMetadataDto } from '../../common/dto/pagination-metadata.dto';

export class AdminUserRecordDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserRecordDto] })
  data!: AdminUserRecordDto[];

  @ApiProperty({ type: PaginationMetadataDto })
  pagination!: PaginationMetadataDto;
}
