import { UserRole, UserStatus } from '../generated/prisma/enums';

export interface AuthenticatedUser {
  email: string;
  id: string;
  role: UserRole;
  status: UserStatus;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}
