import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import { AuditService } from './audit.service';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';
import {
  AuditEventPageDto,
  AuditQueryDto,
  AuditSearchQueryDto,
} from './dto/audit-query.dto';

@ApiTags('audit')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(...PermissionPolicies.auditRead)
  @ApiOperation({ summary: 'Inspect recent audit events' })
  @ApiOkResponse({ type: AuditEventResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid result limit.' })
  @ApiForbiddenResponse({ description: 'Operations or admin access required.' })
  list(@Query() query: AuditQueryDto): Promise<AuditEventResponseDto[]> {
    return this.audit.list(query.limit);
  }

  @Get('search')
  @Roles(...PermissionPolicies.auditRead)
  @ApiOperation({ summary: 'Search and paginate safe audit context' })
  @ApiOkResponse({ type: AuditEventPageDto })
  search(@Query() query: AuditSearchQueryDto): Promise<AuditEventPageDto> {
    return this.audit.search(query);
  }
}
