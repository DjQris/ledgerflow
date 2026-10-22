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
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';

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
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@ApiForbiddenResponse({
  description: 'The signed-in user cannot access the source wallet.',
})
@Controller('transfers')
export class TransfersController {
  constructor(private readonly idempotency: TransferIdempotencyService) {}

  @Post()
  @Roles(...PermissionPolicies.customerTransferCreate)
  @UseInterceptors(TransferRejectionAuditInterceptor)
  @ApiOperation({ summary: 'Transfer from an owned wallet' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Stable key for one transfer request',
  })
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid key or transfer command.',
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferResult> {
    try {
      return await this.idempotency.submitForUser(command, key, user.id);
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
  @Roles(...PermissionPolicies.transferRead)
  @ApiOperation({
    summary: 'Inspect permitted recent outgoing transfers',
  })
  @ApiOkResponse({ type: TransferInspectionDto, isArray: true })
  list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferInspectionDto[]> {
    return user.role === UserRole.CUSTOMER
      ? this.idempotency.listForUser(user.id)
      : this.idempotency.listForStaff();
  }
}
