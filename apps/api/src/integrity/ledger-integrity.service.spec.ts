import { PrismaService } from '../prisma/prisma.service';
import { LedgerIntegrityService } from './ledger-integrity.service';

describe('LedgerIntegrityService', () => {
  function serviceWithRows(rows: unknown[][]) {
    const transaction = { $queryRaw: jest.fn() };
    for (const row of rows) transaction.$queryRaw.mockResolvedValueOnce(row);
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    return { service: new LedgerIntegrityService(prisma), transaction };
  }

  it('returns a uniquely identified report with actual checked counts and no issues', async () => {
    const { service, transaction } = serviceWithRows([
      [{ count: 12n }],
      [{ count: 7n }],
      [{ count: 8n }],
      [],
      [],
    ]);
    const report = await service.verify();

    expect(report).toMatchObject({
      journalCount: '12',
      walletCount: '7',
      accountCount: '8',
      ok: true,
      issues: [],
    });
    expect(report.reportId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Number.isFinite(Date.parse(report.checkedAt))).toBe(true);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it('reports real journal and wallet discrepancies without correcting records', async () => {
    const { service, transaction } = serviceWithRows([
      [{ count: 1n }],
      [{ count: 1n }],
      [{ count: 2n }],
      [
        {
          id: 'journal-1',
          entryCount: 1n,
          totalMinor: '100',
          mismatchedCurrencyCount: 0n,
        },
      ],
      [
        {
          id: 'wallet-1',
          accountId: 'account-1',
          ledgerTotalMinor: '50',
          projectedBalanceMinor: 40n,
        },
      ],
    ]);
    const report = await service.verify();

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'UNBALANCED_JOURNAL',
      'WALLET_BALANCE_MISMATCH',
    ]);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(5);
  });
});
