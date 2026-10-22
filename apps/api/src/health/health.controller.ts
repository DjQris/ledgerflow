import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../access-control/decorators/public.decorator';

import type { HealthResponse } from './health.service';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check API health' })
  @ApiOkResponse({
    description: 'The API is healthy.',
    schema: {
      example: {
        service: 'ledgerflow-api',
        status: 'ok',
        timestamp: '2026-10-21T12:00:00.000Z',
      },
    },
  })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
