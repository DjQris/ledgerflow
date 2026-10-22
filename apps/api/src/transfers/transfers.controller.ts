import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { LocalSimulationGuard } from '../common/guards/local-simulation.guard';

import { TransferCommand } from './dto/transfer.command';
import {
  TransferInspectionDto,
  TransferResponseDto,
} from './dto/transfer-http.dto';
import { TransferResult } from './dto/transfer-result.dto';
import { TransferError } from './errors/transfer.errors';
import { TransferIdempotencyService } from './transfer-idempotency.service';
import { TransferRejectionAuditInterceptor } from './transfer-rejection-audit.interceptor';

@ApiTags('transfers')
@ApiHeader({
  name: 'X-Simulated-Actor',
  required: true,
  description: 'Source wallet test-* owner reference',
})
@ApiForbiddenResponse({
  description:
    'Local development access only, or actor does not own the source wallet.',
})
@UseGuards(LocalSimulationGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly idempotency: TransferIdempotencyService) {}

  @Post()
  @UseInterceptors(TransferRejectionAuditInterceptor)
  @ApiOperation({ summary: 'Submit an idempotent local wallet transfer' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Stable key for one transfer request',
  })
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid key, actor, or transfer command.',
  })
  @ApiConflictResponse({
    description:
      'Key reused with different payload, insufficient funds, or wallet conflict.',
  })
  @ApiNotFoundResponse({ description: 'A wallet was not found.' })
  @ApiInternalServerErrorResponse({
    description: 'The transfer could not be committed.',
  })
  async create(
    @Body() command: TransferCommand,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-simulated-actor') actor: string | undefined,
  ): Promise<TransferResult> {
    try {
      return await this.idempotency.submit(command, key, actor);
    } catch (error: unknown) {
      if (error instanceof TransferError) {
        switch (error.code) {
          case 'INVALID_TRANSFER':
          case 'SELF_TRANSFER':
            throw new BadRequestException(error.message);
          case 'TRANSFER_ACTOR_MISMATCH':
            throw new ForbiddenException(error.message);
          case 'WALLET_NOT_FOUND':
            throw new NotFoundException(error.message);
          case 'INSUFFICIENT_FUNDS':
          case 'TRANSFER_CONFLICT':
          case 'WALLET_UNAVAILABLE':
            throw new ConflictException(error.message);
          case 'TRANSFER_PERSISTENCE_FAILURE':
            throw new InternalServerErrorException(error.message);
        }
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Inspect the 100 most recent outgoing transfers for a local actor',
  })
  @ApiOkResponse({ type: TransferInspectionDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid simulated actor.' })
  list(
    @Headers('x-simulated-actor') actor: string | undefined,
  ): Promise<TransferInspectionDto[]> {
    return this.idempotency.list(actor);
  }
}
