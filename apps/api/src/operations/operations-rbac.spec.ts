import { AuditController } from '../audit/audit.controller';
import { OpsJobsController } from '../background/ops-jobs.controller';
import { ROLES_KEY } from '../access-control/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';
import { LedgerIntegrityController } from '../integrity/ledger-integrity.controller';

const staffRoles = [UserRole.OPERATIONS, UserRole.ADMIN];

describe('operations HTTP role contracts', () => {
  it('restricts job inspection and retry endpoints to operations/admin roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, OpsJobsController)).toEqual(
      staffRoles,
    );
  });

  it('restricts searchable audit and reconciliation endpoints to operations/admin roles', () => {
    const auditSearchHandler = Object.getOwnPropertyDescriptor(
      AuditController.prototype,
      'search',
    )?.value as unknown as object;
    expect(Reflect.getMetadata(ROLES_KEY, auditSearchHandler)).toEqual(
      staffRoles,
    );
    expect(Reflect.getMetadata(ROLES_KEY, LedgerIntegrityController)).toEqual(
      staffRoles,
    );
  });
});
