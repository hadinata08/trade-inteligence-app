import Redis from "ioredis";
import { disconnectPrisma } from "@iti/database";
import { RedisRateLimiter, enqueuePendingSyncJobs, isSyncPaused, recoverStaleJobs } from "@iti/comtrade";
import { DEFAULT_DAILY_BUDGET, DEFAULT_MIN_INTERVAL_MS, DEFAULT_QUOTA_WINDOW_HOURS, logger } from "@iti/shared";

const redis = new Redis(process.env.REDIS_URL || "");
let timer: NodeJS.Timeout | undefined;

async function tick() {
  const locked = await redis.set("iti:scheduler:lock", String(process.pid), "EX", 25, "NX");
  if (locked !== "OK") return;
  if (await isSyncPaused()) return;
  const limiter = new RedisRateLimiter(redis, {
    budget: numberEnv("COMTRADE_DAILY_REQUEST_BUDGET", DEFAULT_DAILY_BUDGET),
    intervalMs: numberEnv("COMTRADE_MIN_REQUEST_INTERVAL_MS", DEFAULT_MIN_INTERVAL_MS),
    windowMs: numberEnv("COMTRADE_QUOTA_WINDOW_HOURS", DEFAULT_QUOTA_WINDOW_HOURS) * 60 * 60 * 1000,
  });
  const remaining = await limiter.remaining();
  if (remaining <= 0 && process.env.COMTRADE_API_KEY) {
    logger.info("scheduler skipped tick because the rolling quota is exhausted", { remaining });
    return;
  }
  const slots = process.env.COMTRADE_API_KEY ? Math.min(8, remaining) : 8;
  const enqueued = await enqueuePendingSyncJobs(process.env.REDIS_URL || "", slots);
  if (enqueued) logger.info("scheduler enqueued sync jobs", { enqueued, remaining });
}

async function main() {
  const recovered = await recoverStaleJobs();
  logger.info("scheduler starting", { recovered });
  await tick();
  timer = setInterval(() => {
    tick().catch((error) => logger.error("scheduler tick failed", { error: error instanceof Error ? error.message : String(error) }));
  }, 30_000);
}

async function shutdown() {
  if (timer) clearInterval(timer);
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
main().catch((error) => {
  logger.error("scheduler failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
