import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FailedJobRecord } from './failure.service';
import { OpsJobQueryDto } from './ops-job-query.dto';
import { OpsJobsService } from './ops-jobs.service';

@ApiTags('operations')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@ApiForbiddenResponse({
  description: 'Operations or admin permission required.',
})
@Controller('ops')
@Roles(...PermissionPolicies.backgroundOperations)
@Throttle({ ip: { limit: 60, ttl: 60_000 } })
export class OpsJobsController {
  constructor(private readonly jobs: OpsJobsService) {}

  @Get('jobs/failed')
  @ApiOperation({ summary: 'Inspect filtered background job failure records' })
  listFailed(@Query() query: OpsJobQueryDto): Promise<FailedJobRecord[]> {
    return this.jobs.listFailed(query);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Inspect one background failure record' })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<FailedJobRecord> {
    return this.jobs.get(id);
  }

  @Post('jobs/:id/retry')
  @ApiSecurity('csrf-token')
  @ApiOperation({ summary: 'Request an audited, idempotent background retry' })
  retry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ status: string; jobId: string }> {
    return this.jobs.retry(id, actor);
  }

  @Get('outbox')
  @ApiOperation({ summary: 'Inspect recent outbox delivery status' })
  listOutbox(
    @Query('limit') limit?: string,
  ): ReturnType<OpsJobsService['listOutbox']> {
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!/^[1-9][0-9]{0,2}$/.test(limit ?? '50') || parsed > 100) {
      throw new BadRequestException('Limit must be between 1 and 100');
    }
    return this.jobs.listOutbox(parsed);
  }
}
