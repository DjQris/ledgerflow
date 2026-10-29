import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../access-control/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';
import { CustomerTransactionDetailsDto } from './dto/customer-transaction-details.dto';
import { WalletsService } from './wallets.service';

@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({ description: 'An active session is required.' })
@ApiForbiddenResponse({
  description: 'The signed-in user cannot access this transaction.',
})
@Controller('transactions')
export class CustomerTransactionsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get(':id')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({
    summary: 'Get a transaction visible to the signed-in customer',
  })
  @ApiOkResponse({ type: CustomerTransactionDetailsDto })
  @ApiNotFoundResponse({
    description:
      'The transaction does not exist or is not available to this customer.',
  })
  getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomerTransactionDetailsDto> {
    return this.walletsService.getTransactionDetailsForUser(id, user);
  }
}
