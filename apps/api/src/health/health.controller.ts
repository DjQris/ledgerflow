import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
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

  @Get('ready')
  @ApiOperation({ summary: 'Check API database readiness' })
  @ApiOkResponse({ description: 'The financial database is reachable.' })
  @ApiServiceUnavailableResponse({
    description: 'The database is unavailable.',
  })
  async getReadiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const result = await this.healthService.getReadiness();
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
