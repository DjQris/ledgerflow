import { Queue, Worker } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';

export async function checkBackgroundReadiness(
  prisma: PrismaService,
  queue: Queue,
  worker?: Worker,
): Promise<boolean> {
  if (worker && !worker.isRunning()) return false;
  try {
    await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      queue.getJobCounts('waiting'),
    ]);
    return true;
  } catch {
    return false;
  }
}
