import { NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  it('searches and paginates users while returning only safe identity fields', async () => {
    const user = {
      id: 'a5e0df47-36f4-4314-8a04-71464ba8996c',
      email: 'staff@example.com',
      role: 'OPERATIONS',
      status: 'ACTIVE',
      createdAt: new Date('2026-10-21T17:00:00.000Z'),
      passwordHash: 'never return',
    };
    const prisma = {
      user: {
        count: jest.fn().mockResolvedValue(21),
        findMany: jest.fn().mockResolvedValue([user]),
      },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaService;
    const service = new AdminUsersService(prisma, new AuditService(prisma));
    const query = Object.assign(new AdminUserQueryDto(), { page: 2, pageSize: 10, search: 'staff', role: 'OPERATIONS' });

    const result = await service.search(query);

    expect(result).toEqual({
      data: [{
        id: user.id, email: user.email, role: user.role, status: user.status,
        createdAt: user.createdAt.toISOString(),
      }],
      pagination: { page: 2, pageSize: 10, total: 21, totalPages: 3 },
    });
    expect(JSON.stringify(result)).not.toContain('never return');
  });

  it('returns a not-found response for absent user details', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    const service = new AdminUsersService(prisma, new AuditService(prisma));
    await expect(service.get('a5e0df47-36f4-4314-8a04-71464ba8996c')).rejects.toBeInstanceOf(NotFoundException);
  });
});
