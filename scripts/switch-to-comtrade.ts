import Redis from "ioredis";
import { getPrisma, disconnectPrisma } from "@iti/database";
import { ComtradeClient, RedisRateLimiter, startLiveBackfill } from "@iti/comtrade";

const key = process.env.COMTRADE_API_KEY?.trim();
if (!key) {
  console.error("COMTRADE_API_KEY is empty.");
  process.exit(1);
}

async function main() {
const prisma = getPrisma();
const removedObservations = await prisma.tradeObservation.deleteMany({ where: { sourceKind: "FIXTURE" } });
const removedSummaries = await prisma.partnerPeriodSummary.deleteMany({ where: { sourceKind: "FIXTURE" } });
await prisma.$executeRaw`DELETE FROM commodity_period_summaries`;
await prisma.datasetMeta.upsert({
  where: { id: 1 },
  create: {
    id: 1,
    sourceKind: "UN_COMTRADE",
    classificationLabel: "HS / H6",
    hs8Status: "UNVERIFIED",
    notes: "Data contoh dihapus. Backfill UN Comtrade sedang berjalan.",
  },
  update: {
    sourceKind: "UN_COMTRADE",
    hs8Status: "UNVERIFIED",
    hs8Note: null,
    notes: "Data contoh dihapus. Backfill UN Comtrade sedang berjalan.",
  },
});

const redis = new Redis(process.env.REDIS_URL || "");
const budget = Number(process.env.COMTRADE_DAILY_REQUEST_BUDGET || 450);
const intervalMs = Number(process.env.COMTRADE_MIN_REQUEST_INTERVAL_MS || 1500);
const windowMs = Number(process.env.COMTRADE_QUOTA_WINDOW_HOURS || 24) * 60 * 60 * 1000;
const client = new ComtradeClient({
  apiKey: key,
  rateLimiter: new RedisRateLimiter(redis, { budget, intervalMs, windowMs }),
  usageLogger: async (entry) => {
    await prisma.apiUsage.create({ data: entry });
  },
});

const jobs = await startLiveBackfill(client, prisma);
console.log(
  JSON.stringify({
    removedObservations: removedObservations.count,
    removedSummaries: removedSummaries.count,
    plannedJobs: jobs,
  }),
);
await redis.quit();
await disconnectPrisma();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
