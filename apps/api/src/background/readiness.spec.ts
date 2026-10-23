import { Queue, Worker } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { checkBackgroundReadiness } from './readiness';

describe('background dependency readiness', () => {
  const query = jest.fn();
  const counts = jest.fn();
  const running = jest.fn();
  const prisma = { $queryRaw: query } as unknown as PrismaService;
  const queue = { getJobCounts: counts } as unknown as Queue;
  const worker = { isRunning: running } as unknown as Worker;

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    counts.mockReset().mockResolvedValue({ waiting: 0 });
    running.mockReset().mockReturnValue(true);
  });

  it('requires PostgreSQL, Redis, and an active worker', async () => {
    expect(await checkBackgroundReadiness(prisma, queue, worker)).toBe(true);
    query.mockRejectedValueOnce(new Error('private database detail'));
    expect(await checkBackgroundReadiness(prisma, queue, worker)).toBe(false);
    counts.mockRejectedValueOnce(new Error('private Redis detail'));
    expect(await checkBackgroundReadiness(prisma, queue, worker)).toBe(false);
    running.mockReturnValue(false);
    expect(await checkBackgroundReadiness(prisma, queue, worker)).toBe(false);
  });
});
