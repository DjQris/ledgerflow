import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { UserRole, UserStatus } from '../generated/prisma/enums';

export function simulatedUserEmail(walletId: string): string {
  return `simulated-${walletId}@ledgerflow.invalid`;
}

@Injectable()
export class UsersService {
  async provisionForSimulatedWallet(
    transaction: Prisma.TransactionClient,
    walletId: string,
  ): Promise<string> {
    const user = await transaction.user.create({
      data: {
        email: simulatedUserEmail(walletId),
        id: walletId,
        role: UserRole.CUSTOMER,
        status: UserStatus.SUSPENDED,
      },
      select: { id: true },
    });
    return user.id;
  }
}
