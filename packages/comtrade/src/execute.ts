import { Prisma, type PrismaClient } from "@prisma/client";
import {
  persistObservations,
  refreshSummaries,
  upsertPartners,
  type PersistResult,
  getPrisma,
} from "@iti/database";
import { logger, stableId } from "@iti/shared";
import { createFixtureSource, FIXTURE_PARTNER_CODES, fixtureObservations } from "./fixture";
import { planBackfill, splitInHalf } from "./planner";
import { ComtradeError, type SyncPartition, type TradeSource } from "./types";

export type ExecuteResult = {
  received: number;
  stored: number;
  warnings: string[];
  split: boolean;
};

const FIXTURE_JOB_NOTE = "Loaded from deterministic fixture seed.";

export async function executePartition(
  partition: SyncPartition,
  source: TradeSource,
  prisma: PrismaClient = getPrisma(),
): Promise<ExecuteResult> {
  if (!partition.force) {
    const existing = await prisma.syncCheckpoint.findUnique({
      where: { partitionIdentifier: partition.key },
    });
    if (existing?.completenessStatus === "COMPLETE" && existing.truncated === false) {
      return { received: existing.sourceRecordCount, stored: existing.storedRecordCount, warnings: [], split: false };
    }
  }

  if (partition.kind === "partners") {
    const partners = await source.getPartners();
    const stored = await upsertPartners(
      partners.map((partner) => ({
        m49Code: partner.m49Code,
        partnerName: partner.partnerName,
        iso2: partner.iso2,
        iso3: partner.iso3,
        entityType: partner.entityType,
      })),
      prisma,
    );
    const tradable = partners
      .filter((partner) => partner.entityType === "COUNTRY" || partner.entityType === "TERRITORY")
      .map((partner) => partner.m49Code);
    const codes = source.mode === "fixture" ? [...FIXTURE_PARTNER_CODES] : tradable;
    await enqueuePlan(
      [
        ...planBackfill(codes).filter((job) => job.kind !== "partners"),
        ...(source.mode === "live" ? worldTotalPartitions() : []),
      ],
      prisma,
    );
    return { received: partners.length, stored, warnings: [], split: false };
  }

  if (partition.kind === "availability") {
    const snapshot = await source.getAvailability(partition.frequency ?? "A", partition.periods);
    await prisma.availabilitySnapshot.create({
      data: { scope: snapshot.scope, payload: snapshot.payload as Prisma.InputJsonValue },
    });
    await writeCheckpoint(prisma, partition.key, {
      sourceRecordCount: 1,
      storedRecordCount: 1,
      status: "COMPLETE",
      truncated: false,
      coverage: { scope: snapshot.scope },
    });
    return { received: 1, stored: 1, warnings: [], split: false };
  }

  if (partition.kind === "tariff-availability") {
    const tariff = await source.getTariffAvailability();
    await touchDataset(prisma, {
      hs8Status: tariff.status,
      hs8Note: tariff.reason,
    });
    await writeCheckpoint(prisma, partition.key, {
      sourceRecordCount: tariff.supported ? 1 : 0,
      storedRecordCount: 0,
      status: tariff.supported ? "PARTIAL" : "UNAVAILABLE",
      truncated: false,
      coverage: { reason: tariff.reason },
    });
    return { received: tariff.supported ? 1 : 0, stored: 0, warnings: [tariff.reason], split: false };
  }

  if (partition.kind === "reconcile") {
    await reconcileAll(prisma, source.mode);
    await writeCheckpoint(prisma, partition.key, {
      sourceRecordCount: 0,
      storedRecordCount: 0,
      status: "COMPLETE",
      truncated: false,
      coverage: { reconciled: true },
    });
    return { received: 0, stored: 0, warnings: [], split: false };
  }

  if (partition.partnerCodes.length === 0 || partition.periods.length === 0 || !partition.cmdCode || partition.hsLevel == null) {
    throw new ComtradeError(`Trade partition ${partition.key} is missing parameters.`);
  }

  const result = await source.getTrade({
    frequency: partition.frequency ?? "A",
    periods: partition.periods,
    partnerCodes: partition.partnerCodes,
    flowCode: partition.flowCode ?? "X,M",
    cmdCode: partition.cmdCode,
    hsLevel: partition.hsLevel,
  });

  if (result.truncated) {
    const children = childPartitions(partition);
    if (!children.length) {
      await writeCheckpoint(prisma, partition.key, {
        sourceRecordCount: result.count,
        storedRecordCount: 0,
        status: "FAILED",
        truncated: true,
        coverage: { warnings: result.warnings },
      });
      throw new ComtradeError("Truncated UN Comtrade response could not be split further.");
    }
    await enqueuePlan(children, prisma);
    await writeCheckpoint(prisma, partition.key, {
      sourceRecordCount: result.count,
      storedRecordCount: 0,
      status: "PARTIAL",
      truncated: true,
      coverage: { splitInto: children.map((child) => child.key), warnings: result.warnings },
    });
    return { received: result.count, stored: 0, warnings: result.warnings, split: true };
  }

  if (result.conflicts.length) {
    await prisma.observationConflict.createMany({
      data: result.conflicts.map((conflict) => ({ identityKey: conflict.identityKey, values: conflict.values })),
    });
  }

  const persisted: PersistResult = await persistObservations(
    result.observations,
    {
      replaceScope:
        result.conflicts.length === 0
          ? {
              partnerCodes: partition.partnerCodes,
              periodCodes: partition.periods,
              flows: partition.flowCode === "X" ? ["EXPORT"] : partition.flowCode === "M" ? ["IMPORT"] : ["EXPORT", "IMPORT"],
              hsLevel: partition.hsLevel,
            }
          : null,
    },
    prisma,
  );

  await writeCheckpoint(prisma, partition.key, {
    sourceRecordCount: result.count,
    storedRecordCount: persisted.stored,
    status: result.periodsMissing.length || result.conflicts.length ? "PARTIAL" : "COMPLETE",
    truncated: false,
    coverage: {
      periodsMissing: result.periodsMissing,
      conflicts: result.conflicts.length,
      warnings: result.warnings,
      revisions: persisted.revisions,
    },
  });
  return { received: result.count, stored: persisted.stored, warnings: result.warnings, split: false };
}

export async function loadFixtureDataset(prisma: PrismaClient = getPrisma()): Promise<{ observations: number }> {
  const liveRows = await prisma.tradeObservation.count({ where: { sourceKind: "UN_COMTRADE" } });
  if (liveRows > 0) {
    throw new Error("Data UN Comtrade sudah tersimpan. Data contoh tidak dimuat.");
  }
  const source = createFixtureSource();
  await upsertPartners(await source.getPartners(), prisma);
  const observations = fixtureObservations();
  const persisted = await persistObservations(observations, {}, prisma);
  const plan = planBackfill([...FIXTURE_PARTNER_CODES]);
  await enqueuePlan(plan, prisma);
  await prisma.syncJob.updateMany({
    where: { partitionKey: { in: plan.map((job) => job.key) } },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      recordsStored: persisted.stored,
      errorMessage: FIXTURE_JOB_NOTE,
    },
  });
  await prisma.syncCheckpoint.createMany({
    data: plan
      .filter((job) => job.kind === "trade" || job.kind === "availability" || job.kind === "tariff-availability")
      .map((job) => ({
        partitionIdentifier: job.key,
        sourceRecordCount: persisted.stored,
        storedRecordCount: persisted.stored,
        dataCoverage: { mode: "fixture-seed" },
        completenessStatus: job.kind === "tariff-availability" ? "PARTIAL" : "COMPLETE",
        truncated: false,
        lastVerifiedAt: new Date(),
      })),
    skipDuplicates: true,
  });
  await touchDataset(prisma, {
    sourceKind: "FIXTURE",
    classificationLabel: "HS / H6",
    hs8Status: "PARTIAL",
    hs8Note: "Fixture HS8 hanya mencakup 15119010 untuk Tiongkok, Singapura, dan Malaysia.",
    notes: "DATA CONTOH. Bukan statistik resmi UN Comtrade. Nilai dibuat secara deterministik agar alur aplikasi bisa diuji tanpa kunci API.",
    lastSyncedAt: new Date(),
  });
  logger.info("fixture dataset loaded", { stored: persisted.stored, conflicts: persisted.conflicts });
  return { observations: persisted.stored };
}

export async function startLiveBackfill(source: TradeSource, prisma: PrismaClient = getPrisma()): Promise<number> {
  if (source.mode !== "live") throw new ComtradeError("Live backfill requires the UN Comtrade client.");
  await prisma.syncJob.deleteMany({ where: { errorMessage: FIXTURE_JOB_NOTE } });
  await prisma.syncCheckpoint.deleteMany({
    where: { dataCoverage: { path: ["mode"], equals: "fixture-seed" } },
  });
  const partners = await source.getPartners();
  await upsertPartners(
    partners.map((partner) => ({
      m49Code: partner.m49Code,
      partnerName: partner.partnerName,
      iso2: partner.iso2,
      iso3: partner.iso3,
      entityType: partner.entityType,
    })),
    prisma,
  );
  const codes = partners
    .filter((partner) => partner.entityType === "COUNTRY" || partner.entityType === "TERRITORY")
    .map((partner) => partner.m49Code);
  const plan = [...planBackfill(codes), ...worldTotalPartitions()];
  await enqueuePlan(plan, prisma);
  await touchDataset(prisma, {
    sourceKind: "UN_COMTRADE",
    notes: "Backfill UN Comtrade berjalan. Cakupan masih sebagian sampai seluruh partisi selesai. Nilai yang belum diunduh ditampilkan sebagai tidak tersedia, bukan nol.",
  });
  return plan.length;
}

export async function retryFailedJobs(prisma: PrismaClient = getPrisma()): Promise<number> {
  const result = await prisma.syncJob.updateMany({
    where: { status: "FAILED" },
    data: { status: "PENDING", errorMessage: null, nextRetryAt: new Date() },
  });
  return result.count;
}

export async function retryIncomplete(prisma: PrismaClient = getPrisma()): Promise<number> {
  const incomplete = await prisma.syncCheckpoint.findMany({
    where: { completenessStatus: { in: ["PARTIAL", "FAILED", "UNVERIFIED"] }, truncated: true },
    select: { partitionIdentifier: true },
  });
  if (!incomplete.length) return 0;
  const result = await prisma.syncJob.updateMany({
    where: { partitionKey: { in: incomplete.map((row) => row.partitionIdentifier) }, status: { in: ["COMPLETED", "FAILED"] } },
    data: { status: "PENDING", nextRetryAt: new Date() },
  });
  return result.count;
}

export async function refreshCountry(partnerCode: string, prisma: PrismaClient = getPrisma()): Promise<number> {
  const jobs = await prisma.syncJob.findMany({
    where: { stage: { in: ["B", "C", "D", "E", "F"] } },
  });
  const matching = jobs.filter((job) => {
    const params = job.partitionParameters as SyncPartition;
    return Array.isArray(params.partnerCodes) && params.partnerCodes.includes(partnerCode);
  });
  if (!matching.length) return 0;
  await prisma.syncCheckpoint.deleteMany({
    where: { partitionIdentifier: { in: matching.map((job) => job.partitionKey) } },
  });
  await prisma.syncJob.updateMany({
    where: { id: { in: matching.map((job) => job.id) } },
    data: { status: "PENDING", errorMessage: null, nextRetryAt: new Date(), completedAt: null },
  });
  return matching.length;
}

export async function refreshPeriod(periodCode: string, prisma: PrismaClient = getPrisma()): Promise<number> {
  const all = await prisma.syncJob.findMany();
  const matching = all.filter((job) => {
    const params = job.partitionParameters as SyncPartition;
    return Array.isArray(params.periods) && params.periods.includes(periodCode);
  });
  if (!matching.length) return 0;
  await prisma.syncCheckpoint.deleteMany({
    where: { partitionIdentifier: { in: matching.map((job) => job.partitionKey) } },
  });
  await prisma.syncJob.updateMany({
    where: { id: { in: matching.map((job) => job.id) } },
    data: { status: "PENDING", errorMessage: null, nextRetryAt: new Date(), completedAt: null },
  });
  return matching.length;
}

export async function setSyncPaused(paused: boolean, prisma: PrismaClient = getPrisma()): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: "sync_paused" },
    create: { key: "sync_paused", value: { paused } },
    update: { value: { paused } },
  });
}

export async function isSyncPaused(prisma: PrismaClient = getPrisma()): Promise<boolean> {
  const setting = await prisma.appSetting.findUnique({ where: { key: "sync_paused" } });
  return Boolean(setting && typeof setting.value === "object" && setting.value && (setting.value as { paused?: boolean }).paused);
}

export async function recoverStaleJobs(prisma: PrismaClient = getPrisma(), staleMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const result = await prisma.syncJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: { status: "PENDING", errorMessage: "Recovered after worker restart", nextRetryAt: new Date() },
  });
  return result.count;
}

export function worldTotalPartitions(): SyncPartition[] {
  return planBackfill(["0"]).filter((job) => job.kind === "trade" && job.cmdCode === "TOTAL");
}

export async function enqueuePlan(partitions: SyncPartition[], prisma: PrismaClient = getPrisma()): Promise<void> {
  if (!partitions.length) return;
  await prisma.syncJob.createMany({
    data: partitions.map((partition) => ({
      jobId: partition.key,
      queueName: partition.queue,
      stage: partition.stage,
      partitionKey: partition.key,
      partitionParameters: partition as unknown as Prisma.InputJsonValue,
      status: "PENDING",
      priority: partition.priority,
    })),
    skipDuplicates: true,
  });
}

function childPartitions(partition: SyncPartition): SyncPartition[] {
  if (partition.partnerCodes.length > 1) {
    const [left, right] = splitInHalf(partition.partnerCodes);
    return [retarget(partition, { partnerCodes: left }), retarget(partition, { partnerCodes: right })];
  }
  if (partition.periods.length > 1) {
    const [left, right] = splitInHalf(partition.periods);
    return [retarget(partition, { periods: left }), retarget(partition, { periods: right })];
  }
  return [];
}

function retarget(
  partition: SyncPartition,
  patch: Partial<Pick<SyncPartition, "partnerCodes" | "periods">>,
): SyncPartition {
  const next: SyncPartition = {
    ...partition,
    partnerCodes: patch.partnerCodes ? [...patch.partnerCodes] : partition.partnerCodes,
    periods: patch.periods ? [...patch.periods] : partition.periods,
    force: true,
  };
  next.key = stableId("sync", {
    kind: next.kind,
    frequency: next.frequency ?? null,
    periods: [...next.periods].sort(),
    partnerCodes: [...next.partnerCodes].sort(),
    flowCode: next.flowCode ?? null,
    cmdCode: next.cmdCode ?? null,
    hsLevel: next.hsLevel ?? null,
  });
  return next;
}

async function writeCheckpoint(
  prisma: PrismaClient,
  partitionIdentifier: string,
  input: {
    sourceRecordCount: number;
    storedRecordCount: number;
    status: "COMPLETE" | "PARTIAL" | "MISSING" | "UNAVAILABLE" | "UNVERIFIED" | "FAILED";
    truncated: boolean;
    coverage: Prisma.InputJsonValue;
  },
) {
  await prisma.syncCheckpoint.upsert({
    where: { partitionIdentifier },
    create: {
      partitionIdentifier,
      sourceRecordCount: input.sourceRecordCount,
      storedRecordCount: input.storedRecordCount,
      dataCoverage: input.coverage,
      completenessStatus: input.status,
      truncated: input.truncated,
      lastVerifiedAt: new Date(),
    },
    update: {
      sourceRecordCount: input.sourceRecordCount,
      storedRecordCount: input.storedRecordCount,
      dataCoverage: input.coverage,
      completenessStatus: input.status,
      truncated: input.truncated,
      lastVerifiedAt: new Date(),
    },
  });
}

async function reconcileAll(prisma: PrismaClient, mode: TradeSource["mode"]) {
  const partners = await prisma.partner.findMany({ select: { m49Code: true } });
  const periods = await prisma.reportingPeriod.findMany({ select: { id: true } });
  const periodIds = periods.map((period) => period.id);
  for (let index = 0; index < partners.length; index += 25) {
    const codes = partners.slice(index, index + 25).map((partner) => partner.m49Code);
    if (codes.length && periodIds.length) await refreshSummaries(prisma, codes, periodIds);
  }
  const fixtureRows = await prisma.tradeObservation.count({ where: { sourceKind: "FIXTURE" } });
  const liveRows = await prisma.tradeObservation.count({ where: { sourceKind: "UN_COMTRADE" } });
  await touchDataset(prisma, {
    sourceKind: liveRows > 0 && fixtureRows === 0 ? "UN_COMTRADE" : "FIXTURE",
    lastSyncedAt: new Date(),
    notes:
      fixtureRows > 0
        ? "Sebagian atau seluruh observasi masih DATA CONTOH, bukan publikasi UN Comtrade."
        : mode === "live"
          ? "Observasi tersimpan berasal dari UN Comtrade."
          : "Tidak ada observasi.",
  });
}

async function touchDataset(
  prisma: PrismaClient,
  patch: {
    sourceKind?: "FIXTURE" | "UN_COMTRADE";
    classificationLabel?: string;
    hs8Status?: string;
    hs8Note?: string | null;
    notes?: string | null;
    lastSyncedAt?: Date | null;
  },
) {
  const current = await prisma.datasetMeta.findUnique({ where: { id: 1 } });
  const data = {
    sourceKind: patch.sourceKind ?? current?.sourceKind ?? "FIXTURE",
    classificationLabel: patch.classificationLabel ?? current?.classificationLabel ?? "HS / H6",
    hs8Status: patch.hs8Status ?? current?.hs8Status ?? "UNVERIFIED",
    hs8Note: patch.hs8Note === undefined ? current?.hs8Note : patch.hs8Note,
    notes: patch.notes === undefined ? current?.notes : patch.notes,
    lastSyncedAt: patch.lastSyncedAt === undefined ? current?.lastSyncedAt : patch.lastSyncedAt,
  };
  await prisma.datasetMeta.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
}
