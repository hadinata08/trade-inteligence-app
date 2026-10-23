import Decimal from "decimal.js";
import { CUMULATIVE_2026, USD_PER_MILLION, type CompletenessStatus } from "./constants";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function decimal(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Divide after aggregation. Callers must not round the USD amount first. */
export function toMillionUsd(usd: string | Decimal): Decimal {
  return decimal(usd).div(USD_PER_MILLION);
}

export function millionUsdString(usd: string | Decimal): string {
  return toMillionUsd(usd).toFixed(6);
}

export function tradeBalance(exportUsd: string | null, importUsd: string | null): string | null {
  if (exportUsd == null || importUsd == null) return null;
  return decimal(exportUsd).minus(decimal(importUsd)).toFixed(2);
}

/**
 * Percent change. A zero or missing base is not a number — return null
 * instead of inventing infinity or zero growth.
 */
export function growthRate(current: string | null, previous: string | null): string | null {
  if (current == null || previous == null) return null;
  const base = decimal(previous);
  if (base.isZero()) return null;
  return decimal(current).minus(base).div(base.abs()).times(100).toFixed(4);
}

export type MonthPoint = {
  month: number;
  exportUsd: string | null;
  importUsd: string | null;
  verified: boolean;
};

export type CumulativeResult = {
  status: Extract<CompletenessStatus, "COMPLETE" | "PARTIAL" | "MISSING">;
  exportUsd: string | null;
  importUsd: string | null;
  monthsPresent: number[];
  monthsMissing: number[];
  /** Sum of months that exist. Not an official total when status is PARTIAL. */
  disclosedPartialExportUsd: string | null;
  disclosedPartialImportUsd: string | null;
};

/**
 * January–August cumulative values are the sum of the eight monthly observations.
 * If any required month is missing, the official cumulative value is null.
 * Missing months are never coerced to zero.
 */
export function cumulativeMonths(
  points: MonthPoint[],
  required: readonly number[] = CUMULATIVE_2026.months,
): CumulativeResult {
  const byMonth = new Map(points.map((point) => [point.month, point]));
  const monthsMissing: number[] = [];
  const monthsPresent: number[] = [];
  let exportSum = new Decimal(0);
  let importSum = new Decimal(0);
  let exportCount = 0;
  let importCount = 0;

  for (const month of required) {
    const point = byMonth.get(month);
    const exportOk = Boolean(point?.verified && point.exportUsd != null);
    const importOk = Boolean(point?.verified && point.importUsd != null);
    if (!exportOk || !importOk) monthsMissing.push(month);
    if (exportOk || importOk) monthsPresent.push(month);
    if (exportOk && point?.exportUsd != null) {
      exportSum = exportSum.plus(point.exportUsd);
      exportCount += 1;
    }
    if (importOk && point?.importUsd != null) {
      importSum = importSum.plus(point.importUsd);
      importCount += 1;
    }
  }

  const disclosedPartialExportUsd = exportCount > 0 ? exportSum.toFixed(2) : null;
  const disclosedPartialImportUsd = importCount > 0 ? importSum.toFixed(2) : null;

  if (exportCount === 0 && importCount === 0) {
    return {
      status: "MISSING",
      exportUsd: null,
      importUsd: null,
      monthsPresent: [],
      monthsMissing: [...required],
      disclosedPartialExportUsd: null,
      disclosedPartialImportUsd: null,
    };
  }

  const complete = exportCount === required.length && importCount === required.length && monthsMissing.length === 0;
  if (complete) {
    return {
      status: "COMPLETE",
      exportUsd: exportSum.toFixed(2),
      importUsd: importSum.toFixed(2),
      monthsPresent: [...required],
      monthsMissing: [],
      disclosedPartialExportUsd: null,
      disclosedPartialImportUsd: null,
    };
  }

  return {
    status: "PARTIAL",
    exportUsd: null,
    importUsd: null,
    monthsPresent,
    monthsMissing,
    disclosedPartialExportUsd,
    disclosedPartialImportUsd,
  };
}

export type LevelValue = {
  level: number;
  valueUsd: string | null;
};

/**
 * Sum one HS level only. Other levels in the input are ignored so HS2+HS4+HS6
 * can never be added into a single total by accident.
 */
export function sumTradeAtLevel(
  rows: LevelValue[],
  level: number,
): { sumUsd: string | null; included: number; missing: number } {
  const subset = rows.filter((row) => row.level === level);
  const missing = subset.filter((row) => row.valueUsd == null).length;
  const present = subset.filter((row) => row.valueUsd != null);
  if (present.length === 0) return { sumUsd: null, included: 0, missing };
  const sum = present.reduce((acc, row) => acc.plus(row.valueUsd as string), new Decimal(0));
  return {
    sumUsd: missing === 0 ? sum.toFixed(2) : null,
    included: present.length,
    missing,
  };
}

export function compareTotalWithLevel(totalUsd: string | null, levelSumUsd: string | null): {
  comparable: boolean;
  differenceUsd: string | null;
} {
  if (totalUsd == null || levelSumUsd == null) return { comparable: false, differenceUsd: null };
  return {
    comparable: true,
    differenceUsd: decimal(totalUsd).minus(levelSumUsd).toFixed(2),
  };
}
