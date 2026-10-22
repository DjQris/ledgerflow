import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LocalSimulationGuard } from '../common/guards/local-simulation.guard';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletTransactionHistoryDto } from './dto/wallet-transaction-history.dto';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  @Roles(...PermissionPolicies.customerWalletCreate)
  @ApiOperation({ summary: 'Create an NGN wallet for the signed-in customer' })
  @ApiSecurity('csrf-token')
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiCreatedResponse({ type: WalletResponseDto })
  @ApiBadRequestResponse({ description: 'The request body is invalid.' })
  @ApiConflictResponse({ description: 'The customer already has a wallet.' })
  create(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletResponseDto> {
    if (!body || Array.isArray(body) || Object.keys(body).length !== 0) {
      throw new BadRequestException('Wallet creation takes no owner fields');
    }
    return this.walletsService.createForCustomer(user);
  }

  @Post('simulated')
  @Roles(...PermissionPolicies.userAdmin)
  @UseGuards(LocalSimulationGuard)
  @ApiOperation({
    summary: 'Create a local-only provisional simulation wallet',
  })
  @ApiSecurity('csrf-token')
  @ApiCreatedResponse({ type: WalletResponseDto })
  createSimulated(@Body() input: CreateWalletDto): Promise<WalletResponseDto> {
    return this.walletsService.create(input);
  }

  @Get()
  @Roles(...PermissionPolicies.walletRead)
  @ApiOperation({ summary: 'List wallets' })
  @ApiOkResponse({ type: WalletResponseDto, isArray: true })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletResponseDto[]> {
    return this.walletsService.findAllForUser(user);
  }

  @Get(':id')
  @Roles(...PermissionPolicies.walletRead)
  @ApiOperation({ summary: 'Get a wallet by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: WalletResponseDto })
  @ApiBadRequestResponse({ description: 'The wallet ID is not a UUID.' })
  @ApiNotFoundResponse({ description: 'The wallet does not exist.' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletResponseDto> {
    return this.walletsService.findOneForUser(id, user);
  }

  @Get(':id/transactions')
  @Roles(...PermissionPolicies.walletRead)
  @ApiOperation({ summary: 'List posted transactions for a wallet' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: WalletTransactionHistoryDto })
  @ApiBadRequestResponse({
    description: 'The wallet ID or pagination query is invalid.',
  })
  @ApiNotFoundResponse({ description: 'The wallet does not exist.' })
  getTransactions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: WalletTransactionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletTransactionHistoryDto> {
    return this.walletsService.getTransactionsForUser(id, query, user);
  }
}
