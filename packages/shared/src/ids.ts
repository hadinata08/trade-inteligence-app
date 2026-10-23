import { createHash } from "node:crypto";

export function observationIdentity(parts: {
  reporterCode: string;
  partnerCode: string;
  secondPartnerCode: string;
  periodId: string;
  flow: string;
  commodityId: string;
  customsCode: string;
  transportMode: string;
}): string {
  return [
    parts.reporterCode,
    parts.partnerCode,
    parts.secondPartnerCode,
    parts.periodId,
    parts.flow,
    parts.commodityId,
    parts.customsCode,
    parts.transportMode,
  ].join("|");
}

/** Identity used before a commodity row has a database id. */
export function naturalObservationKey(parts: {
  reporterCode: string;
  partnerCode: string;
  secondPartnerCode: string;
  periodCode: string;
  flow: string;
  hsCode: string;
  customsCode: string;
  transportMode: string;
}): string {
  return [
    parts.reporterCode,
    parts.partnerCode,
    parts.secondPartnerCode,
    parts.periodCode,
    parts.flow,
    parts.hsCode,
    parts.customsCode,
    parts.transportMode,
  ].join("|");
}

export function stableId(prefix: string, payload: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, 32);
  return `${prefix}_${hash}`;
}

export function fingerprint(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
