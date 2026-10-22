import { ApiProperty } from '@nestjs/swagger';

import { UserRole, UserStatus } from '../../generated/prisma/enums';
import { AuthenticatedUser } from '../auth.types';

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  static fromUser(user: AuthenticatedUser): UserProfileDto {
    return {
      email: user.email,
      id: user.id,
      role: user.role,
      status: user.status,
    };
  }
}
