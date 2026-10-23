import {
  ANNUAL_YEARS,
  MONTHLY_2026,
  PLAN_RECORD_FILL,
  QUEUE_NAMES,
  annualPeriodCode,
  monthlyPeriodCode,
  stableId,
} from "@iti/shared";
import type { SyncPartition } from "./types";

const CMD_CARDINALITY: Record<string, number> = {
  TOTAL: 1,
  AG2: 98,
  AG4: 1300,
  AG6: 6000,
};

export function estimateRecords(partners: number, cmd: string, periods: number, flows: number): number {
  return partners * (CMD_CARDINALITY[cmd] ?? 1) * Math.max(periods, 1) * Math.max(flows, 1);
}

export function splitPartners(
  partners: string[],
  cmd: string,
  periods: number,
  flows: number,
  maxRecords: number,
): string[][] {
  const unique = [...new Set(partners)];
  const budget = Math.max(1, Math.floor(maxRecords * PLAN_RECORD_FILL));
  const perPartner = Math.max(1, estimateRecords(1, cmd, periods, flows));
  const size = Math.max(1, Math.floor(budget / perPartner));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks.length ? chunks : [[]];
}

export function splitInHalf<T>(items: T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

function tradePartition(input: {
  stage: SyncPartition["stage"];
  queue: SyncPartition["queue"];
  frequency: "A" | "M";
  periods: string[];
  partnerCodes: string[];
  cmdCode: string;
  hsLevel: number;
  priority: number;
}): SyncPartition {
  const payload = {
    kind: "trade" as const,
    frequency: input.frequency,
    periods: [...input.periods].sort(),
    partnerCodes: [...input.partnerCodes].sort(),
    flowCode: "X,M" as const,
    cmdCode: input.cmdCode,
    hsLevel: input.hsLevel,
  };
  return {
    key: stableId("sync", payload),
    queue: input.queue,
    stage: input.stage,
    priority: input.priority,
    ...payload,
  };
}

export function planBackfill(partnerCodes: string[], maxRecords = 100_000): SyncPartition[] {
  const partners = [...new Set(partnerCodes)].sort();
  const annual = ANNUAL_YEARS.map((year) => annualPeriodCode(year));
  const monthly = MONTHLY_2026.map((month) => monthlyPeriodCode(2026, month));
  const jobs: SyncPartition[] = [
    {
      key: stableId("sync", { kind: "partners" }),
      queue: QUEUE_NAMES.partnerSync,
      stage: "A",
      kind: "partners",
      periods: [],
      partnerCodes: [],
      priority: 1,
    },
    {
      key: stableId("sync", { kind: "availability", frequency: "A" }),
      queue: QUEUE_NAMES.hsReferenceSync,
      stage: "A",
      kind: "availability",
      frequency: "A",
      periods: annual,
      partnerCodes: [],
      priority: 2,
    },
    {
      key: stableId("sync", { kind: "availability", frequency: "M" }),
      queue: QUEUE_NAMES.hsReferenceSync,
      stage: "A",
      kind: "availability",
      frequency: "M",
      periods: monthly,
      partnerCodes: [],
      priority: 3,
    },
    {
      key: stableId("sync", { kind: "tariff-availability" }),
      queue: QUEUE_NAMES.hsReferenceSync,
      stage: "F",
      kind: "tariff-availability",
      periods: ["2024"],
      partnerCodes: [],
      priority: 4,
    },
  ];

  const pushCmd = (
    stage: SyncPartition["stage"],
    frequency: "A" | "M",
    periods: string[],
    cmdCode: string,
    hsLevel: number,
    priority: number,
    queue: SyncPartition["queue"],
  ) => {
    if (!partners.length || !periods.length) return;
    for (const batch of splitPartners(partners, cmdCode, periods.length, 2, maxRecords)) {
      jobs.push(
        tradePartition({
          stage,
          queue,
          frequency,
          periods,
          partnerCodes: batch,
          cmdCode,
          hsLevel,
          priority,
        }),
      );
    }
  };

  pushCmd("B", "A", annual, "TOTAL", 0, 10, QUEUE_NAMES.annualTradeSync);
  pushCmd("B", "M", monthly, "TOTAL", 0, 12, QUEUE_NAMES.monthlyTradeSync);
  for (const period of annual) {
    pushCmd("C", "A", [period], "AG2", 2, 20, QUEUE_NAMES.commodityDetailSync);
    pushCmd("D", "A", [period], "AG4", 4, 30, QUEUE_NAMES.commodityDetailSync);
    pushCmd("E", "A", [period], "AG6", 6, 40, QUEUE_NAMES.commodityDetailSync);
  }
  for (const period of monthly) {
    pushCmd("C", "M", [period], "AG2", 2, 22, QUEUE_NAMES.commodityDetailSync);
    pushCmd("D", "M", [period], "AG4", 4, 32, QUEUE_NAMES.commodityDetailSync);
    pushCmd("E", "M", [period], "AG6", 6, 42, QUEUE_NAMES.commodityDetailSync);
  }

  jobs.push({
    key: stableId("sync", { kind: "reconcile" }),
    queue: QUEUE_NAMES.reconciliation,
    stage: "R",
    kind: "reconcile",
    periods: [],
    partnerCodes: partners,
    priority: 90,
  });
  return jobs;
}
