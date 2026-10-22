import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { UserStatus } from '../../generated/prisma/enums';

export class ChangeStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus;
}
