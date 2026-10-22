import { UserRole, UserStatus } from '../generated/prisma/enums';

export interface AuthenticatedUser {
  email: string;
  id: string;
  role: UserRole;
  status: UserStatus;
}

export interface AuthenticatedSessionUser extends AuthenticatedUser {
  sessionId: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}
