import { BadRequestException, Injectable } from '@nestjs/common';

import { serializeMinorUnits } from '../common/money/minor-units';
import { Prisma } from '../generated/prisma/client';
import { TransferStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsMetricsQueryDto } from './operations-metrics-query.dto';
import { OperationsMetricsDto } from './operations-metrics.dto';

interface DailyTransferRow {
  date: string;
  completedCount: number;
  failedCount: number;
  completedMinor: string;
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function readDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || utcDate(date) !== value) {
    throw new BadRequestException('Dates must be valid ISO calendar days');
  }
  return date;
}

@Injectable()
export class OperationsMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(query: OperationsMetricsQueryDto): Promise<OperationsMetricsDto> {
    const today = utcDate(new Date());
    const to = query.to ?? today;
    const toDate = readDate(to);
    const fromDate = query.from
      ? readDate(query.from)
      : new Date(toDate.getTime() - 29 * 86_400_000);
    if (fromDate > toDate) throw new BadRequestException('from must not be after to');
    const endExclusive = new Date(toDate.getTime() + 86_400_000);
    const days = Math.floor((endExclusive.getTime() - fromDate.getTime()) / 86_400_000);
    if (days > 366) throw new BadRequestException('Date range cannot exceed 366 days');

    const [completed, recordedFailedTransferCount, registeredUsers, pending, activity, dailyRows] = await Promise.all([
      this.prisma.transfer.aggregate({
        _count: { _all: true },
        _sum: { amountMinor: true },
        where: { status: TransferStatus.COMPLETED, completedAt: { gte: fromDate, lt: endExclusive } },
      }),
      this.prisma.transfer.count({
        where: { status: TransferStatus.FAILED, createdAt: { gte: fromDate, lt: endExclusive } },
      }),
      this.prisma.user.count(),
      this.prisma.$queryRaw<[{ pendingRetries: number; pendingOutboxEvents: number }]>(Prisma.sql`
        SELECT
          (SELECT COUNT(*)::int FROM "failed_background_jobs" WHERE "status" IN ('retry_pending', 'retrying')) AS "pendingRetries",
          (SELECT COUNT(*)::int FROM "outbox_events" WHERE "status"::text = 'pending') AS "pendingOutboxEvents"
      `),
      this.prisma.auditEvent.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { action: true, actorType: true, entityType: true, occurredAt: true, outcome: true },
        take: 10,
      }),
      this.prisma.$queryRaw<DailyTransferRow[]>(Prisma.sql`
        SELECT TO_CHAR((CASE WHEN "status"::text = 'completed' THEN "completed_at" ELSE "created_at" END AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS "date",
          COUNT(*) FILTER (WHERE "status"::text = 'completed')::int AS "completedCount",
          COUNT(*) FILTER (WHERE "status"::text = 'failed')::int AS "failedCount",
          COALESCE(SUM("amount_minor") FILTER (WHERE "status"::text = 'completed'), 0)::text AS "completedMinor"
        FROM "transfers"
        WHERE (("status"::text = 'completed' AND "completed_at" >= ${fromDate} AND "completed_at" < ${endExclusive})
          OR ("status"::text = 'failed' AND "created_at" >= ${fromDate} AND "created_at" < ${endExclusive}))
        GROUP BY (CASE WHEN "status"::text = 'completed' THEN "completed_at" ELSE "created_at" END AT TIME ZONE 'UTC')::date
        ORDER BY (CASE WHEN "status"::text = 'completed' THEN "completed_at" ELSE "created_at" END AT TIME ZONE 'UTC')::date ASC
      `),
    ]);

    const byDate = new Map(dailyRows.map((row) => [row.date, row]));
    const daily: OperationsMetricsDto['daily'] = [];
    for (let index = 0; index < days; index += 1) {
      const date = utcDate(new Date(fromDate.getTime() + index * 86_400_000));
      const row = byDate.get(date);
      daily.push({
        date,
        completedCount: row?.completedCount ?? 0,
        failedCount: row?.failedCount ?? 0,
        completedMinor: row?.completedMinor ?? '0',
      });
    }

    return {
      from: utcDate(fromDate),
      to,
      timeZone: 'UTC',
      completedCount: completed._count._all,
      completedMinor: serializeMinorUnits(completed._sum.amountMinor ?? 0n),
      recordedFailedTransferCount,
      registeredUsers,
      pendingRetries: pending[0]?.pendingRetries ?? 0,
      pendingOutboxEvents: pending[0]?.pendingOutboxEvents ?? 0,
      daily,
      recentActivity: activity.map((event) => ({
        action: event.action,
        actorType: event.actorType,
        entityType: event.entityType,
        occurredAt: event.occurredAt.toISOString(),
        outcome: event.outcome,
      })),
    };
  }
}
