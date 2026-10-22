import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LocalSimulationGuard } from '../common/guards/local-simulation.guard';
import { AuditService } from './audit.service';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('audit')
@Controller('audit-events')
@UseGuards(LocalSimulationGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Inspect recent audit events in local development' })
  @ApiOkResponse({ type: AuditEventResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid result limit.' })
  @ApiForbiddenResponse({ description: 'Local development access only.' })
  list(@Query() query: AuditQueryDto): Promise<AuditEventResponseDto[]> {
    return this.audit.list(query.limit);
  }
}
