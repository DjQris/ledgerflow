import { Controller, Get } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import { LedgerIntegrityService } from './ledger-integrity.service';
import { LedgerIntegrityReportDto } from './ledger-integrity.dto';

@ApiTags('operations')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@ApiForbiddenResponse({
  description: 'Operations or admin permission required.',
})
@Controller('ops/reconciliation')
@Roles(...PermissionPolicies.backgroundOperations)
@Throttle({ ip: { limit: 10, ttl: 60_000 } })
export class LedgerIntegrityController {
  constructor(private readonly integrity: LedgerIntegrityService) {}

  @Get()
  @ApiOperation({ summary: 'Run the read-only ledger integrity verification' })
  @ApiOkResponse({ type: LedgerIntegrityReportDto })
  verify(): Promise<LedgerIntegrityReportDto> {
    return this.integrity.verify();
  }
}
