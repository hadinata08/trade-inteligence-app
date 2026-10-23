import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { QUEUE_NAMES, redisConnectionFromUrl, type QueueName } from "@iti/shared";
import { getPrisma } from "@iti/database";
import { isSyncPaused } from "./execute";

const PREFIX = "iti";

export function connectionOptions(redisUrl = process.env.REDIS_URL || ""): ConnectionOptions {
  if (!redisUrl) throw new Error("REDIS_URL is not set.");
  return redisConnectionFromUrl(redisUrl) as ConnectionOptions;
}

export function createQueue(name: QueueName, redisUrl = process.env.REDIS_URL || ""): Queue {
  return new Queue(name, { connection: connectionOptions(redisUrl), prefix: PREFIX });
}

export function bullPrefix(): string {
  return PREFIX;
}

export async function enqueuePendingSyncJobs(redisUrl: string, limit: number): Promise<number> {
  if (await isSyncPaused()) return 0;
  const prisma = getPrisma();
  const pending = await prisma.syncJob.findMany({
    where: {
      status: "PENDING",
      queueName: { in: Object.values(QUEUE_NAMES).filter((name) => name !== QUEUE_NAMES.excelGeneration) },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  const queues = new Map<string, Queue>();
  let enqueued = 0;
  try {
    for (const job of pending) {
      const queueName = job.queueName as QueueName;
      const queue = queues.get(queueName) ?? createQueue(queueName, redisUrl);
      queues.set(queueName, queue);
      const existing = await queue.getJob(job.jobId);
      if (!existing) {
        const options: JobsOptions = {
          jobId: job.jobId,
          priority: Math.max(1, job.priority),
          attempts: 5,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: 1_000,
          removeOnFail: 2_000,
        };
        await queue.add(queueName, job.partitionParameters, options);
      }
      await prisma.syncJob.update({ where: { id: job.id }, data: { status: "QUEUED" } });
      enqueued += 1;
    }
  } finally {
    await Promise.all([...queues.values()].map((queue) => queue.close()));
  }
  return enqueued;
}

export async function enqueueExcelExport(exportId: string, redisUrl = process.env.REDIS_URL || ""): Promise<void> {
  const queue = createQueue(QUEUE_NAMES.excelGeneration, redisUrl);
  try {
    const existing = await queue.getJob(exportId);
    if (!existing) {
      await queue.add(
        QUEUE_NAMES.excelGeneration,
        { exportId },
        {
          jobId: exportId,
          priority: 1,
          attempts: 2,
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      );
    }
  } finally {
    await queue.close();
  }
}

export async function setQueuesPaused(redisUrl: string, paused: boolean): Promise<void> {
  const names = Object.values(QUEUE_NAMES);
  await Promise.all(
    names.map(async (name) => {
      const queue = createQueue(name, redisUrl);
      try {
        if (paused) await queue.pause();
        else await queue.resume();
      } finally {
        await queue.close();
      }
    }),
  );
}
