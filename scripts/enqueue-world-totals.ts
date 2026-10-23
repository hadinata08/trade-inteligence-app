import { enqueuePlan, worldTotalPartitions } from "@iti/comtrade";
import { disconnectPrisma } from "@iti/database";

async function main() {
  const jobs = worldTotalPartitions();
  await enqueuePlan(jobs);
  console.log(JSON.stringify({ queued: jobs.length, stages: jobs.map((job) => job.stage) }));
  await disconnectPrisma();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
