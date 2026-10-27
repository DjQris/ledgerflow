import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../generated/prisma/enums';

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

  @ApiProperty({ example: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
  pagination!: { page: number; pageSize: number; total: number; totalPages: number };
}
