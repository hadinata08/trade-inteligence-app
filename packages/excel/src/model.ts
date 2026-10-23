import { EXCEL_MAX_ROWS, EXCEL_MAX_SHEET_NAME, EXCEL_PRACTICAL_ROWS, growthRate, toMillionUsd } from "@iti/shared";
import Decimal from "decimal.js";

export const SHEET = {
  dashboard: "01 DASHBOARD",
  summary: "02 SUMMARY ALL COUNTRIES",
  coverage: "99 DATA COVERAGE",
  lookups: "_LOOKUPS",
  totals: "_TOTALS",
  hs: "_HS",
  trends: "_TRENDS",
  rankCmd: "_RANK_CMD",
  level: "_LEVEL",
  view: "_VIEW",
  comp: "_COMP",
} as const;

export type WorkbookPartner = {
  code: string;
  name: string;
  aggregate: boolean;
};

export type WorkbookPeriod = {
  code: string;
  label: string;
  kind: "ANNUAL" | "MONTHLY" | "CUMULATIVE";
};

export type MoneyRow = {
  partnerCode: string;
  periodCode: string;
  exportUsd: string | null;
  importUsd: string | null;
  completeness: string;
  sourceUpdatedAt: string | null;
};

export type CommodityRow = {
  partnerCode: string;
  periodCode: string;
  hsCode: string;
  level: number;
  parentCode: string | null;
  description: string;
  exportUsd: string | null;
  importUsd: string | null;
  sourceStatus: string;
};

export type WorkbookInput = {
  generatedAt: string;
  sourceLabel: string;
  sourceKind: "UN_COMTRADE" | "FIXTURE" | "MIXED" | "EMPTY";
  classification: string;
  lastSyncedAt: string | null;
  coveragePercent: number;
  warnings: string[];
  hs8Status: string;
  partners: WorkbookPartner[];
  periods: WorkbookPeriod[];
  totals: MoneyRow[];
  /** Annual totals kept for the dashboard charts when the export itself covers fewer years. */
  chartTotals?: MoneyRow[];
  chartPeriods?: WorkbookPeriod[];
  commodities: CommodityRow[];
  helperCommodities: CommodityRow[];
  /** Extra commodity rows used only to rank dashboard charts. */
  chartCommodities?: CommodityRow[];
  /**
   * Total per negara, periode, dan level HS atas SEMUA kode (bukan hanya baris peringkat).
   * Kunci `${partnerCode}|${periodCode}|${level}`. Dipakai agar irisan "Lainnya" sama dengan situs.
   */
  levelTotals?: Record<string, { exportUsd: string | null; importUsd: string | null }>;
  cumulative: { label: string; monthCodes: string[] } | null;
  includeCharts: boolean;
  includeDetail: boolean;
  includeCoverage: boolean;
};

export type RankRow = { name: string; value: number | null };
export type CmdRank = { key: string; description: string; value: number | null };

export type LevelRank = {
  key: string;
  code: string;
  description: string;
  exportMn: number | null;
  importMn: number | null;
  growthPct: number | null;
};

const GROWTH_BASE_USD = new Decimal(1_000_000);

export function partnerLabel(partner: WorkbookPartner): string {
  if (partner.code === "0") return "World (agregat resmi)";
  return partner.name.trim();
}

export function commodityLabel(code: string, description: string): string {
  if (code === "TOTAL") return "TOTAL";
  return `${code} — ${description}`.slice(0, 140);
}

export function buildSheetName(index: number, name: string, code: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || code;
  const prefix = `${index} `;
  let candidate = `${prefix}${cleaned}`.slice(0, EXCEL_MAX_SHEET_NAME).trim();
  if (used.has(candidate.toLowerCase())) {
    const suffix = ` ${code}`;
    candidate = `${`${prefix}${cleaned}`.slice(0, Math.max(1, EXCEL_MAX_SHEET_NAME - suffix.length)).trim()}${suffix}`
      .slice(0, EXCEL_MAX_SHEET_NAME)
      .trim();
  }
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const extra = `~${n}`;
    candidate = `${candidate.slice(0, EXCEL_MAX_SHEET_NAME - extra.length)}${extra}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function toMillionNumber(usd: string | null): number | null {
  if (usd == null || usd === "") return null;
  return Number(toMillionUsd(usd).toFixed(6));
}

/** Nilai USD utuh. Pembagian juta dilakukan setelah tahun terpilih dijumlahkan. */
export function toUsdNumber(usd: string | null): number | null {
  if (usd == null || usd === "") return null;
  return Number(new Decimal(usd).toFixed(2));
}

export type CompositionRow = {
  partner: string;
  level: string;
  code: string;
  description: string;
  /** USD per tahun, sejajar dengan daftar tahun tahunan. Kosong berarti observasi tidak ada. */
  exportUsd: Array<number | null>;
  importUsd: Array<number | null>;
};

/**
 * Satu baris per negara, level HS, dan kode. Tahun tetap terpisah supaya Excel
 * bisa menjumlahkan tahun yang diberi tanda Ya, sama dengan komposisi di situs.
 */
export function buildCompositionGrid(rows: CommodityRow[], partners: WorkbookPartner[], annualPeriods: WorkbookPeriod[]): CompositionRow[] {
  const names = new Map(partners.map((partner) => [partner.code, partnerLabel(partner)]));
  const slotOf = new Map(annualPeriods.map((period, index) => [period.code, index]));
  const grouped = new Map<string, CompositionRow>();
  for (const row of rows) {
    if (row.hsCode === "TOTAL" || (row.level !== 2 && row.level !== 4 && row.level !== 6)) continue;
    const partner = names.get(row.partnerCode);
    const slot = slotOf.get(row.periodCode);
    if (!partner || slot == null) continue;
    const key = `${partner}|HS${row.level}|${row.hsCode}`;
    const current = grouped.get(key) ?? {
      partner,
      level: `HS${row.level}`,
      code: row.hsCode,
      description: row.description,
      exportUsd: Array<number | null>(annualPeriods.length).fill(null),
      importUsd: Array<number | null>(annualPeriods.length).fill(null),
    };
    if (row.description) current.description = row.description;
    if (row.exportUsd != null && current.exportUsd[slot] == null) current.exportUsd[slot] = toUsdNumber(row.exportUsd);
    if (row.importUsd != null && current.importUsd[slot] == null) current.importUsd[slot] = toUsdNumber(row.importUsd);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => left.partner.localeCompare(right.partner) || left.level.localeCompare(right.level) || left.code.localeCompare(right.code));
}

export function topCommodities(
  rows: CommodityRow[],
  partners: WorkbookPartner[],
  periodLabel: (periodCode: string) => string,
  limit = 10,
): CmdRank[] {
  const names = new Map(partners.map((partner) => [partner.code, partnerLabel(partner)]));
  const grouped = new Map<string, { description: string; usd: Decimal }[]>();
  for (const row of rows) {
    if (row.level !== 2 || row.exportUsd == null) continue;
    const label = names.get(row.partnerCode);
    if (!label) continue;
    const bucket = `${label}|${periodLabel(row.periodCode)}`;
    const list = grouped.get(bucket) ?? [];
    list.push({ description: commodityLabel(row.hsCode, row.description), usd: new Decimal(row.exportUsd) });
    grouped.set(bucket, list);
  }
  const ranked: CmdRank[] = [];
  for (const [bucket, list] of grouped) {
    list.sort((a, b) => b.usd.comparedTo(a.usd) || a.description.localeCompare(b.description));
    list.slice(0, limit).forEach((row, index) => {
      ranked.push({
        key: `${bucket}|${index + 1}`,
        description: row.description,
        value: Number(row.usd.div(1_000_000).toFixed(6)),
      });
    });
  }
  return ranked;
}

export type VolumePlan = {
  singleWorkbook: boolean;
  files: Array<{ partnerCodes: string[]; rows: number; primary: boolean }>;
  overflowPartners: Array<{ code: string; rows: number }>;
};

export function planVolumes(
  entries: Array<{ code: string; rows: number }>,
  practicalRows = EXCEL_PRACTICAL_ROWS,
): VolumePlan {
  const overflowPartners = entries.filter((entry) => entry.rows > EXCEL_MAX_ROWS - 30);
  const files: VolumePlan["files"] = [];
  let current: { partnerCodes: string[]; rows: number; primary: boolean } | null = null;
  for (const entry of entries) {
    const rows = Math.min(entry.rows, EXCEL_MAX_ROWS - 30);
    if (!current || current.rows + rows > practicalRows) {
      current = { partnerCodes: [], rows: 0, primary: files.length === 0 };
      files.push(current);
    }
    current.partnerCodes.push(entry.code);
    current.rows += rows;
  }
  if (!files.length) files.push({ partnerCodes: [], rows: 0, primary: true });
  return { singleWorkbook: files.length === 1 && overflowPartners.length === 0, files, overflowPartners };
}

export function buildLevelBoard(
  rows: CommodityRow[],
  partners: WorkbookPartner[],
  periods: WorkbookPeriod[],
  levelTotals: WorkbookInput["levelTotals"] = {},
): LevelRank[] {
  const names = new Map(partners.map((partner) => [partner.code, partnerLabel(partner)]));
  const labels = new Map(periods.map((period) => [period.code, period.label]));
  const codeOfPartner = new Map([...names.entries()].map(([code, label]) => [label, code]));
  const codeOfPeriod = new Map([...labels.entries()].map(([code, label]) => [label, code]));
  const grouped = new Map<string, Map<string, { code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null }>>();
  for (const row of rows) {
    if (row.level !== 2 && row.level !== 4 && row.level !== 6) continue;
    const partner = names.get(row.partnerCode);
    const period = labels.get(row.periodCode);
    if (!partner || !period || row.hsCode === "TOTAL") continue;
    const groupKey = `${partner}|${period}|HS${row.level}`;
    const items = grouped.get(groupKey) ?? new Map();
    const current = items.get(row.hsCode) ?? { code: row.hsCode, description: row.description, exportUsd: null, importUsd: null };
    if (row.exportUsd != null) current.exportUsd = new Decimal(row.exportUsd);
    if (row.importUsd != null) current.importUsd = new Decimal(row.importUsd);
    current.description = row.description || current.description;
    items.set(row.hsCode, current);
    grouped.set(groupKey, items);
  }
  const worldName = names.get("0") ?? "World (agregat resmi)";
  const rolled = new Map<string, Map<string, { code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null }>>();
  for (const [groupKey, items] of grouped) {
    const [partner, period, level] = groupKey.split("|");
    if (!partner || !period || !level || partner === worldName) continue;
    const bucketKey = `${period}|${level}`;
    const bucket = rolled.get(bucketKey) ?? new Map();
    for (const item of items.values()) {
      const current = bucket.get(item.code) ?? { code: item.code, description: item.description, exportUsd: null, importUsd: null };
      if (item.exportUsd) current.exportUsd = (current.exportUsd ?? new Decimal(0)).plus(item.exportUsd);
      if (item.importUsd) current.importUsd = (current.importUsd ?? new Decimal(0)).plus(item.importUsd);
      current.description = item.description || current.description;
      bucket.set(item.code, current);
    }
    rolled.set(bucketKey, bucket);
  }
  for (const [bucketKey, items] of rolled) {
    const worldKey = `${worldName}|${bucketKey}`;
    if (!grouped.has(worldKey)) grouped.set(worldKey, items);
  }
  const ranked: LevelRank[] = [];
  for (const [groupKey, items] of grouped) {
    const list = [...items.values()];
    const [partner, period, level] = groupKey.split("|");
    pushValueRanks(ranked, `${partner}|${period}|${level}|X`, list, "export");
    pushValueRanks(ranked, `${partner}|${period}|${level}|M`, list, "import");
    const totals = levelTotals[`${codeOfPartner.get(partner ?? "") ?? ""}|${codeOfPeriod.get(period ?? "") ?? ""}|${(level ?? "").replace("HS", "")}`];
    pushRemainder(ranked, `${partner}|${period}|${level}|XL`, list, "export", totals?.exportUsd ?? null);
    pushRemainder(ranked, `${partner}|${period}|${level}|ML`, list, "import", totals?.importUsd ?? null);
    const previous = previousPeriodLabel(period, periods);
    const prior = previous ? grouped.get(`${partner}|${previous}|${level}`) : undefined;
    pushGrowth(ranked, `${partner}|${period}|${level}|G`, list, prior);
  }
  return ranked;
}

function pushValueRanks(
  ranked: LevelRank[],
  prefix: string,
  list: Array<{ code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null }>,
  flow: "export" | "import",
) {
  const present = list.filter((row) => (flow === "export" ? row.exportUsd : row.importUsd) != null);
  present.sort((left, right) => {
    const a = flow === "export" ? (left.exportUsd as Decimal) : (left.importUsd as Decimal);
    const b = flow === "export" ? (right.exportUsd as Decimal) : (right.importUsd as Decimal);
    return b.comparedTo(a) || left.code.localeCompare(right.code);
  });
  present.slice(0, 10).forEach((row, index) => ranked.push(toLevelRank(`${prefix}|${index + 1}`, row, null)));
}

function pushRemainder(
  ranked: LevelRank[],
  prefix: string,
  list: Array<{ code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null }>,
  flow: "export" | "import",
  levelTotalUsd: string | null = null,
) {
  const value = (row: (typeof list)[number]) => (flow === "export" ? row.exportUsd : row.importUsd);
  const present = list.filter((row) => value(row) != null);
  present.sort((left, right) => (value(right) as Decimal).comparedTo(value(left) as Decimal) || left.code.localeCompare(right.code));
  const top = present.slice(0, 8);
  const rest = present.slice(8);
  // Baris peringkat hanya memuat kode teratas. Bila total level tersedia, "Lainnya" = total − 8 teratas,
  // sama dengan cara situs menghitung komposisi.
  const restUsd = levelTotalUsd != null
    ? new Decimal(levelTotalUsd).minus(top.reduce((sum, row) => sum.plus(value(row) as Decimal), new Decimal(0)))
    : rest.reduce((sum, row) => sum.plus(value(row) as Decimal), new Decimal(0));
  if (levelTotalUsd == null && !rest.length) return;
  if (restUsd.lessThanOrEqualTo(0)) return;
  const exportUsd = flow === "export" ? restUsd : null;
  const importUsd = flow === "import" ? restUsd : null;
  ranked.push({
    key: `${prefix}|1`,
    code: "Lainnya",
    description: levelTotalUsd != null ? "Kode lainnya pada level yang sama" : `${rest.length} kode lainnya pada level yang sama`,
    exportMn: exportUsd == null ? null : Number(exportUsd.div(1_000_000).toFixed(6)),
    importMn: importUsd == null ? null : Number(importUsd.div(1_000_000).toFixed(6)),
    growthPct: null,
  });
}

function pushGrowth(
  ranked: LevelRank[],
  prefix: string,
  current: Array<{ code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null }>,
  previous: Map<string, { code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null }> | undefined,
) {
  if (!previous) return;
  const grown = current
    .map((row) => {
      const before = previous.get(row.code)?.exportUsd ?? null;
      if (before == null || before.lessThan(GROWTH_BASE_USD)) return null;
      const rate = growthRate(row.exportUsd?.toFixed(2) ?? null, before.toFixed(2));
      if (rate == null) return null;
      return { row, rate: Number(rate) };
    })
    .filter((row): row is { row: (typeof current)[number]; rate: number } => row != null)
    .sort((left, right) => right.rate - left.rate || left.row.code.localeCompare(right.row.code))
    .slice(0, 5);
  grown.forEach((item, index) => ranked.push(toLevelRank(`${prefix}|${index + 1}`, item.row, item.rate)));
}

function toLevelRank(
  key: string,
  row: { code: string; description: string; exportUsd: Decimal | null; importUsd: Decimal | null },
  growthPct: number | null,
): LevelRank {
  return {
    key,
    code: row.code,
    description: row.description,
    exportMn: row.exportUsd == null ? null : Number(row.exportUsd.div(1_000_000).toFixed(6)),
    importMn: row.importUsd == null ? null : Number(row.importUsd.div(1_000_000).toFixed(6)),
    growthPct,
  };
}

function previousPeriodLabel(label: string, periods: WorkbookPeriod[]): string | null {
  const period = periods.find((item) => item.label === label && item.kind === "ANNUAL");
  if (!period || !/^\d{4}$/.test(period.code)) return null;
  const previous = String(Number(period.code) - 1);
  return periods.find((item) => item.code === previous)?.label ?? null;
}

export function statusText(exportUsd: string | null, importUsd: string | null, sourceStatus: string): string {
  const normalized = sourceStatus && sourceStatus !== "MISSING" ? sourceStatus : "REPORTED";
  const exp = exportUsd == null ? "MISSING" : normalized;
  const imp = importUsd == null ? "MISSING" : normalized;
  return `Ekspor: ${exp} | Impor: ${imp}`;
}
