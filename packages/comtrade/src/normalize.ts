import { REPORTER, inferHsLevel, inferParentCode, naturalObservationKey } from "@iti/shared";
import type { IncomingObservation } from "@iti/database";
import type { NormalizeResult, TradeQuery } from "./types";

export function normalizeHsCode(cmd: unknown, aggrLevel: number | null): string {
  const raw = String(cmd ?? "").trim();
  if (!raw || raw.toUpperCase() === "TOTAL") return "TOTAL";
  if (!/^\d+$/.test(raw)) return raw;
  const width = aggrLevel === 2 || aggrLevel === 4 || aggrLevel === 6 || aggrLevel === 8 ? aggrLevel : raw.length;
  return raw.length < width ? raw.padStart(width, "0") : raw;
}

export function flowFromCode(flowCode: unknown): "EXPORT" | "IMPORT" | null {
  const code = String(flowCode ?? "").toUpperCase();
  if (code === "X" || code === "EXPORT") return "EXPORT";
  if (code === "M" || code === "IMPORT") return "IMPORT";
  return null;
}

export function parseRetryAfter(header: string | null, now = Date.now()): number {
  if (!header) return 5_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1) * 1_000, 6 * 60 * 60 * 1_000);
  const dated = Date.parse(header);
  if (Number.isFinite(dated)) return Math.min(Math.max(dated - now, 1_000), 6 * 60 * 60 * 1_000);
  return 5_000;
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(base + base * 0.25 * random());
}

export function normalizeComtradePayload(
  payload: unknown,
  query: TradeQuery & { maxRecords: number; sourceKind?: "UN_COMTRADE" | "FIXTURE" },
): NormalizeResult {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = Array.isArray(body.data) ? body.data : [];
  const declared = typeof body.count === "number" ? body.count : data.length;
  const errorText = body.error == null ? "" : String(body.error);
  const truncated =
    declared >= query.maxRecords ||
    data.length >= query.maxRecords ||
    /limit|truncat|maximum number of records/i.test(errorText);
  const warnings: string[] = [];
  if (errorText) warnings.push(errorText);
  if (truncated) warnings.push("Response reached the record ceiling and is treated as incomplete.");

  const requestedPartners = new Set(query.partnerCodes.map(String));
  const observations: IncomingObservation[] = [];
  const grouped = new Map<string, IncomingObservation[]>();

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const reporter = String(row.reporterCode ?? "");
    if (reporter && reporter !== REPORTER.code) {
      warnings.push(`Skipped row with reporter ${reporter}; expected ${REPORTER.code}.`);
      continue;
    }
    const flow = flowFromCode(row.flowCode);
    if (!flow) {
      warnings.push(`Skipped unsupported flow ${String(row.flowCode ?? "")}.`);
      continue;
    }
    const partnerCode = String(row.partnerCode ?? "");
    if (requestedPartners.size && !requestedPartners.has(partnerCode)) {
      warnings.push(`Skipped partner ${partnerCode} outside the requested partition.`);
      continue;
    }
    const periodCode = String(row.period ?? "");
    if (!/^\d{4}(\d{2})?$/.test(periodCode)) {
      warnings.push(`Skipped invalid period ${periodCode}.`);
      continue;
    }
    const aggr = typeof row.aggrLevel === "number" ? row.aggrLevel : query.hsLevel;
    const hsCode = normalizeHsCode(row.cmdCode, aggr);
    const level = hsCode === "TOTAL" ? 0 : inferHsLevel(hsCode);
    const primary = row.primaryValue;
    const tradeValueUsd = primary == null || primary === "" ? null : decimalString(primary);
    const observation: IncomingObservation = {
      reporterCode: REPORTER.code,
      partnerCode,
      partnerName: stringOrUndefined(row.partnerDesc),
      secondPartnerCode: String(row.partner2Code ?? "0"),
      periodCode,
      frequency: periodCode.length === 6 ? "MONTHLY" : "ANNUAL",
      year: Number(periodCode.slice(0, 4)),
      month: periodCode.length === 6 ? Number(periodCode.slice(4)) : null,
      flow,
      hsCode,
      hsLevel: level,
      parentCode: hsCode === "TOTAL" ? null : inferParentCode(hsCode),
      description: String(row.cmdDesc ?? hsCode),
      classificationCode: String(row.classificationCode ?? "HS"),
      customsCode: String(row.customsCode ?? "C00"),
      transportMode: String(row.motCode ?? "0"),
      tradeValueUsd,
      quantity: row.qty == null || row.qty === "" ? null : decimalString(row.qty),
      netWeight: row.netWgt == null || row.netWgt === "" ? null : decimalString(row.netWgt),
      sourceStatus: row.isReported === false ? "ESTIMATED" : "REPORTED",
      sourceUpdatedAt: null,
      isReported: row.isReported !== false,
      sourceKind: query.sourceKind ?? "UN_COMTRADE",
    };
    const key = naturalObservationKey({
      reporterCode: observation.reporterCode,
      partnerCode: observation.partnerCode,
      secondPartnerCode: observation.secondPartnerCode,
      periodCode: observation.periodCode,
      flow: observation.flow,
      hsCode: observation.hsCode,
      customsCode: observation.customsCode,
      transportMode: observation.transportMode,
    });
    const list = grouped.get(key) ?? [];
    list.push(observation);
    grouped.set(key, list);
  }

  const conflicts: Array<{ identityKey: string; values: string[] }> = [];
  for (const [identityKey, list] of grouped) {
    const values = [...new Set(list.map((row) => row.tradeValueUsd ?? "null"))];
    if (values.length > 1) {
      conflicts.push({ identityKey, values });
      continue;
    }
    const kept = list.find((row) => row.tradeValueUsd != null);
    if (kept) observations.push(kept);
  }

  const periodsPresent = [...new Set(observations.map((row) => row.periodCode))].sort();
  const periodsMissing = query.periods.filter((period) => !periodsPresent.includes(period));
  if (periodsMissing.length) {
    warnings.push(`Periods missing from this response: ${periodsMissing.join(", ")}.`);
  }

  return {
    observations,
    conflicts,
    truncated,
    count: declared,
    warnings,
    periodsPresent,
    periodsMissing,
    metadata: {
      elapsedTime: body.elapsedTime ?? null,
      error: body.error ?? null,
      returned: data.length,
    },
  };
}

function decimalString(value: unknown): string | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(2);
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}
