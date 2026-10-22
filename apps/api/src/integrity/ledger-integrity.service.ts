import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface JournalIssueRow {
  entryCount: bigint;
  id: string;
  mismatchedCurrencyCount: bigint;
  totalMinor: string;
}

interface WalletIssueRow {
  accountId: string | null;
  id: string;
  ledgerTotalMinor: string;
  projectedBalanceMinor: bigint | null;
}

interface CountRow {
  count: bigint;
}

export interface LedgerIntegrityIssue {
  code:
    | 'UNBALANCED_JOURNAL'
    | 'JOURNAL_ENTRY_CURRENCY_MISMATCH'
    | 'WALLET_ACCOUNT_MISSING'
    | 'WALLET_BALANCE_MISMATCH';
  resourceId: string;
  resourceType: 'journal' | 'wallet';
  detail: Record<string, string>;
}

export interface LedgerIntegrityReport {
  checkedAt: string;
  journalCount: string;
  walletCount: string;
  ok: boolean;
  issues: LedgerIntegrityIssue[];
}

@Injectable()
export class LedgerIntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(): Promise<LedgerIntegrityReport> {
    return this.prisma.$transaction(
      async (transaction) => {
        const [journalCount, walletCount, journals, wallets] =
          await Promise.all([
            transaction.$queryRaw<
              CountRow[]
            >`SELECT count(*)::bigint AS "count" FROM "ledger_transactions" WHERE "status" = 'posted'`,
            transaction.$queryRaw<
              CountRow[]
            >`SELECT count(*)::bigint AS "count" FROM "wallets"`,
            transaction.$queryRaw<JournalIssueRow[]>`
            SELECT journal."id" AS "id",
                   count(entry."id")::bigint AS "entryCount",
                   coalesce(sum(entry."amount_minor"), 0)::text AS "totalMinor",
                   count(entry."id") FILTER (WHERE account."currency" <> journal."currency")::bigint AS "mismatchedCurrencyCount"
            FROM "ledger_transactions" AS journal
            LEFT JOIN "ledger_entries" AS entry ON entry."transaction_id" = journal."id"
            LEFT JOIN "ledger_accounts" AS account ON account."id" = entry."account_id"
            WHERE journal."status" = 'posted'
            GROUP BY journal."id"
            HAVING count(entry."id") < 2
               OR coalesce(sum(entry."amount_minor"), 0) <> 0
               OR count(entry."id") FILTER (WHERE account."currency" <> journal."currency") > 0
          `,
            transaction.$queryRaw<WalletIssueRow[]>`
            SELECT wallet."id" AS "id",
                   account."id" AS "accountId",
                   account."cached_balance_minor" AS "projectedBalanceMinor",
                   coalesce(sum(entry."amount_minor") FILTER (WHERE journal."status" = 'posted'), 0)::text AS "ledgerTotalMinor"
            FROM "wallets" AS wallet
            LEFT JOIN "ledger_accounts" AS account ON account."wallet_id" = wallet."id"
            LEFT JOIN "ledger_entries" AS entry ON entry."account_id" = account."id"
            LEFT JOIN "ledger_transactions" AS journal ON journal."id" = entry."transaction_id"
            GROUP BY wallet."id", account."id", account."cached_balance_minor"
            HAVING account."id" IS NULL
               OR account."cached_balance_minor" IS DISTINCT FROM
                  coalesce(sum(entry."amount_minor") FILTER (WHERE journal."status" = 'posted'), 0)
          `,
          ]);

        const issues: LedgerIntegrityIssue[] = [];
        for (const journal of journals) {
          if (journal.entryCount < 2n || journal.totalMinor !== '0') {
            issues.push({
              code: 'UNBALANCED_JOURNAL',
              resourceId: journal.id,
              resourceType: 'journal',
              detail: {
                entryCount: journal.entryCount.toString(),
                totalMinor: journal.totalMinor,
              },
            });
          }
          if (journal.mismatchedCurrencyCount > 0n) {
            issues.push({
              code: 'JOURNAL_ENTRY_CURRENCY_MISMATCH',
              resourceId: journal.id,
              resourceType: 'journal',
              detail: {
                mismatchedCurrencyCount:
                  journal.mismatchedCurrencyCount.toString(),
              },
            });
          }
        }
        for (const wallet of wallets) {
          if (!wallet.accountId) {
            issues.push({
              code: 'WALLET_ACCOUNT_MISSING',
              resourceId: wallet.id,
              resourceType: 'wallet',
              detail: {},
            });
          } else {
            issues.push({
              code: 'WALLET_BALANCE_MISMATCH',
              resourceId: wallet.id,
              resourceType: 'wallet',
              detail: {
                ledgerTotalMinor: wallet.ledgerTotalMinor,
                projectedBalanceMinor:
                  wallet.projectedBalanceMinor?.toString() ?? 'null',
              },
            });
          }
        }

        return {
          checkedAt: new Date().toISOString(),
          journalCount: (journalCount[0]?.count ?? 0n).toString(),
          walletCount: (walletCount[0]?.count ?? 0n).toString(),
          ok: issues.length === 0,
          issues,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 20_000,
      },
    );
  }
}
