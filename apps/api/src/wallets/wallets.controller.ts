import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletTransactionHistoryDto } from './dto/wallet-transaction-history.dto';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an NGN wallet for a simulated owner' })
  @ApiCreatedResponse({ type: WalletResponseDto })
  @ApiBadRequestResponse({ description: 'The request body is invalid.' })
  @ApiConflictResponse({
    description: 'The simulated owner already has a wallet.',
  })
  create(@Body() input: CreateWalletDto): Promise<WalletResponseDto> {
    return this.walletsService.create(input);
  }

  @Get()
  @ApiOperation({ summary: 'List wallets' })
  @ApiOkResponse({ type: WalletResponseDto, isArray: true })
  findAll(): Promise<WalletResponseDto[]> {
    return this.walletsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a wallet by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: WalletResponseDto })
  @ApiBadRequestResponse({ description: 'The wallet ID is not a UUID.' })
  @ApiNotFoundResponse({ description: 'The wallet does not exist.' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<WalletResponseDto> {
    return this.walletsService.findOne(id);
  }

  @Get(':id/transactions')
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
  ): Promise<WalletTransactionHistoryDto> {
    return this.walletsService.getTransactions(id, query);
  }
}
