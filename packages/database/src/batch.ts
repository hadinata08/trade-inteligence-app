import { naturalObservationKey } from "@iti/shared";

export type IncomingObservation = {
  reporterCode: string;
  partnerCode: string;
  partnerName?: string;
  secondPartnerCode: string;
  periodCode: string;
  frequency: "ANNUAL" | "MONTHLY";
  year: number;
  month: number | null;
  flow: "EXPORT" | "IMPORT";
  hsCode: string;
  hsLevel: number;
  parentCode: string | null;
  description: string;
  classificationCode: string;
  customsCode: string;
  transportMode: string;
  tradeValueUsd: string | null;
  quantity: string | null;
  netWeight: string | null;
  sourceStatus: string;
  sourceUpdatedAt: string | null;
  isReported: boolean;
  sourceKind: "UN_COMTRADE" | "FIXTURE";
};

export type PreparedBatch = {
  ready: IncomingObservation[];
  conflicts: Array<{ identityKey: string; values: string[] }>;
};

/**
 * Collapse exact duplicates. Distinct values for one identity are conflicts
 * and are not merged into a single number.
 */
export function prepareObservationBatch(rows: IncomingObservation[]): PreparedBatch {
  const groups = new Map<string, IncomingObservation[]>();
  for (const row of rows) {
    if (row.tradeValueUsd == null) continue;
    const key = naturalObservationKey({
      reporterCode: row.reporterCode,
      partnerCode: row.partnerCode,
      secondPartnerCode: row.secondPartnerCode,
      periodCode: row.periodCode,
      flow: row.flow,
      hsCode: row.hsCode,
      customsCode: row.customsCode,
      transportMode: row.transportMode,
    });
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const ready: IncomingObservation[] = [];
  const conflicts: Array<{ identityKey: string; values: string[] }> = [];
  for (const [identityKey, list] of groups) {
    const distinct = [...new Set(list.map((row) => normalizeMoney(row.tradeValueUsd as string)))];
    if (distinct.length > 1) {
      conflicts.push({ identityKey, values: distinct });
      continue;
    }
    ready.push({ ...list[0], tradeValueUsd: distinct[0] });
  }
  return { ready, conflicts };
}

function normalizeMoney(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [whole, fraction = ""] = trimmed.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}
