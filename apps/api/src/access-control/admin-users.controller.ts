import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { AdminUsersService } from './admin-users.service';
import { Roles } from './decorators/roles.decorator';
import { PermissionPolicies } from './permission-policies';
import { ChangeRoleDto } from './dto/change-role.dto';
import { ChangeStatusDto } from './dto/change-status.dto';

@ApiTags('admin')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@ApiForbiddenResponse({ description: 'Administrator permission required.' })
@Controller('admin/users')
@Throttle({ ip: { limit: 60, ttl: 60_000 } })
@Roles(...PermissionPolicies.userAdmin)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List the most recent 100 users' })
  @ApiOkResponse({ type: UserProfileDto, isArray: true })
  list(): Promise<UserProfileDto[]> {
    return this.users.list();
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Assign a permitted user role' })
  @ApiSecurity('csrf-token')
  @ApiOkResponse({ type: UserProfileDto })
  changeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ChangeRoleDto,
  ): Promise<UserProfileDto> {
    return this.users.changeRole(actor, id, input.role);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Suspend or reactivate a user' })
  @ApiSecurity('csrf-token')
  @ApiOkResponse({ type: UserProfileDto })
  changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ChangeStatusDto,
  ): Promise<UserProfileDto> {
    return this.users.changeStatus(actor, id, input.status);
  }
}
