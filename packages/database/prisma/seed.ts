import { allSourcePeriodCodes } from "@iti/shared";
import { disconnectPrisma, getPrisma, upsertPeriods } from "@iti/database";
import { loadFixtureDataset } from "@iti/comtrade";

async function main() {
  const prisma = getPrisma();
  const periods = allSourcePeriodCodes().map((code) =>
    code.length === 4
      ? { periodCode: code, frequency: "ANNUAL" as const, year: Number(code), month: null }
      : { periodCode: code, frequency: "MONTHLY" as const, year: Number(code.slice(0, 4)), month: Number(code.slice(4)) },
  );
  await upsertPeriods(periods, prisma);
  const liveRows = await prisma.tradeObservation.count({ where: { sourceKind: "UN_COMTRADE" } });
  if (liveRows > 0 || (process.env.COMTRADE_API_KEY?.trim() && process.env.COMTRADE_DATA_SOURCE !== "fixture")) {
    console.log("Seed loaded reporting periods only and did not invent trade values.");
    return;
  }
  const result = await loadFixtureDataset(prisma);
  console.log(`Fixture dataset stored ${result.observations} observations.`);
  console.log("These values are synthetic and are labelled FIXTURE. They are not UN Comtrade statistics.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
