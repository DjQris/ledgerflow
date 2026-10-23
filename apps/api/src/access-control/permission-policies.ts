import { UserRole } from '../generated/prisma/enums';

// Explicit allow-lists: adding a new role never grants financial access by default.
export const PermissionPolicies = {
  customerWalletCreate: [UserRole.CUSTOMER],
  customerTransferCreate: [UserRole.CUSTOMER],
  walletRead: [UserRole.CUSTOMER, UserRole.OPERATIONS, UserRole.ADMIN],
  transferRead: [UserRole.CUSTOMER, UserRole.OPERATIONS, UserRole.ADMIN],
  auditRead: [UserRole.OPERATIONS, UserRole.ADMIN],
  backgroundOperations: [UserRole.OPERATIONS, UserRole.ADMIN],
  userAdmin: [UserRole.ADMIN],
  identityRead: [UserRole.CUSTOMER, UserRole.OPERATIONS, UserRole.ADMIN],
} as const;
