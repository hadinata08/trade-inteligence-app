import { DelayedError, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { disconnectPrisma, getPrisma } from "@iti/database";
import {
  ComtradeClient,
  QuotaExceededError,
  RedisRateLimiter,
  bullPrefix,
  connectionOptions,
  createFixtureSource,
  executePartition,
  isSyncPaused,
  recoverStaleJobs,
  type SyncPartition,
  type TradeSource,
} from "@iti/comtrade";
import { DEFAULT_DAILY_BUDGET, DEFAULT_MIN_INTERVAL_MS, DEFAULT_QUOTA_WINDOW_HOURS, SYNC_QUEUES, logger } from "@iti/shared";

let source: TradeSource;

async function main() {
  const recovered = await recoverStaleJobs();
  logger.info("ingestion worker starting", { recovered });
  source = await buildSource();
  const workers = SYNC_QUEUES.map(
    (name) =>
      new Worker(name, processJob, {
        connection: connectionOptions(),
        prefix: bullPrefix(),
        concurrency: 1,
      }),
  );
  const shutdown = async () => {
    logger.info("ingestion worker shutting down");
    await Promise.all(workers.map((worker) => worker.close()));
    await disconnectPrisma();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

async function processJob(job: Job): Promise<void> {
  if (await isSyncPaused()) {
    await job.moveToDelayed(Date.now() + 15_000, job.token);
    throw new DelayedError();
  }
  const partition = job.data as SyncPartition;
  const prisma = getPrisma();
  await prisma.syncJob.update({
    where: { partitionKey: partition.key },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });
  try {
    const result = await executePartition(partition, source, prisma);
    await prisma.syncJob.update({
      where: { partitionKey: partition.key },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        recordsReceived: result.received,
        recordsStored: result.stored,
        errorMessage: result.warnings.filter(Boolean).join(" ") || null,
      },
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      await prisma.syncJob.update({
        where: { partitionKey: partition.key },
        data: { status: "PENDING", nextRetryAt: new Date(Date.now() + error.retryAtMs), errorMessage: error.message },
      });
      await job.moveToDelayed(Date.now() + Math.max(error.retryAtMs, 1_000), job.token);
      throw new DelayedError();
    }
    const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await prisma.syncJob.update({
      where: { partitionKey: partition.key },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        errorMessage: error instanceof Error ? error.message : String(error),
        nextRetryAt: exhausted ? null : new Date(Date.now() + 30_000),
      },
    });
    throw error;
  }
}

async function buildSource(): Promise<TradeSource> {
  const key = process.env.COMTRADE_API_KEY?.trim();
  const mode = process.env.COMTRADE_DATA_SOURCE || "auto";
  if (mode === "fixture" || !key) {
    logger.warn("using fixture trade source", { reason: key ? "COMTRADE_DATA_SOURCE=fixture" : "COMTRADE_API_KEY is empty" });
    return createFixtureSource();
  }
  const redis = new Redis(process.env.REDIS_URL || "");
  const budget = numberEnv("COMTRADE_DAILY_REQUEST_BUDGET", DEFAULT_DAILY_BUDGET);
  const limiter = new RedisRateLimiter(redis, {
    budget,
    intervalMs: numberEnv("COMTRADE_MIN_REQUEST_INTERVAL_MS", DEFAULT_MIN_INTERVAL_MS),
    windowMs: numberEnv("COMTRADE_QUOTA_WINDOW_HOURS", DEFAULT_QUOTA_WINDOW_HOURS) * 60 * 60 * 1000,
  });
  const since = new Date(Date.now() - numberEnv("COMTRADE_QUOTA_WINDOW_HOURS", DEFAULT_QUOTA_WINDOW_HOURS) * 60 * 60 * 1000);
  const history = await getPrisma().apiUsage.findMany({ where: { timestamp: { gte: since }, statusCode: { gt: 0 } }, select: { timestamp: true } });
  await limiter.hydrate(history.map((row) => row.timestamp));
  return new ComtradeClient({
    apiKey: key,
    baseUrl: process.env.COMTRADE_BASE_URL,
    allowedHosts: (process.env.COMTRADE_ALLOWED_HOSTS || "comtradeapi.un.org").split(",").map((host) => host.trim()),
    maxRecords: numberEnv("COMTRADE_MAX_RECORDS", 100_000),
    rateLimiter: limiter,
    usageLogger: async (entry) => {
      await getPrisma().apiUsage.create({ data: entry });
    },
  });
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

main().catch((error) => {
  logger.error("ingestion worker failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
