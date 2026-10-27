import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import { OperationsMetricsQueryDto } from './operations-metrics-query.dto';
import { OperationsMetricsDto } from './operations-metrics.dto';
import { OperationsMetricsService } from './operations-metrics.service';

@ApiTags('operations')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@ApiForbiddenResponse({ description: 'Operations or admin permission required.' })
@Controller('operations')
@Roles(...PermissionPolicies.operationsDashboardRead)
export class OperationsMetricsController {
  constructor(private readonly metrics: OperationsMetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Read aggregated operational metrics for a UTC date range' })
  @ApiOkResponse({ type: OperationsMetricsDto })
  get(@Query() query: OperationsMetricsQueryDto): Promise<OperationsMetricsDto> {
    return this.metrics.get(query);
  }
}
