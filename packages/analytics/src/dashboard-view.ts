import { decimal, growthRate, millionUsdString } from "@iti/shared";

export type HsLevel = 2 | 4 | 6;

export type CommodityValue = {
  code: string;
  description: string;
  usd: string | null;
};

export type TrendPoint = {
  period: string;
  exportMn: string | null;
  importMn: string | null;
  balanceMn: string | null;
};

export function parseHsLevel(value: string | undefined): HsLevel {
  if (value === "4" || value === "6") return Number(value) as HsLevel;
  return 2;
}

/**
 * Pilihan periode ganda dari URL ("2023,2024" atau beberapa parameter). Kode yang tidak dikenal dibuang.
 * Kumulatif 2026 dipertahankan sebagai satu kode; pemanggil memperluasnya menjadi bulan.
 * Bila kosong, kembali ke tahun tahunan terakhir.
 */
export function parsePeriods(input: string | string[] | undefined, available: string[], fallback: string | undefined): string[] {
  const raw = (Array.isArray(input) ? input : [input ?? ""]).flatMap((value) => value.split(","));
  const known = new Set(available);
  const picked = [...new Set(raw.map((value) => value.trim()).filter((value) => known.has(value)))];
  picked.sort((left, right) => available.indexOf(left) - available.indexOf(right));
  if (picked.length) return picked;
  return fallback ? [fallback] : [];
}

/** Menambah atau melepas satu periode dari pilihan; pilihan tidak pernah kosong. */
export function togglePeriod(selected: string[], code: string): string[] {
  if (selected.includes(code)) {
    const rest = selected.filter((item) => item !== code);
    return rest.length ? rest : selected;
  }
  return [...selected, code];
}

/** Jumlah beberapa periode. Satu periode yang hilang membuat total n.a. (null), bukan nol. */
export function sumPeriods(values: Array<string | null | undefined>): string | null {
  if (!values.length || values.some((value) => value == null)) return null;
  return values.reduce((sum, value) => sum.plus(decimal(value as string)), decimal(0)).toFixed(2);
}

/** Label kategori grafik: kode HS dan uraian yang dipotong. */
export function commodityAxisLabel(code: string, description: string, max = 28): string {
  if (code === "Lainnya" || code === "LAINNYA") return "Lainnya";
  const text = description.length > max ? `${description.slice(0, max - 1).trimEnd()}…` : description;
  return `${code} · ${text}`;
}

export function compositionSlices(rows: CommodityValue[], limit = 8) {
  const present = rows.filter((row): row is CommodityValue & { usd: string } => row.usd != null);
  const ranked = [...present].sort((left, right) => decimal(right.usd).comparedTo(decimal(left.usd)));
  const total = ranked.reduce((sum, row) => sum.plus(decimal(row.usd)), decimal(0));
  if (total.isZero()) return [];
  const top = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  const slices = top.map((row) => ({
    code: row.code,
    name: row.code,
    description: row.description,
    valueMn: millionUsdString(row.usd),
    sharePct: decimal(row.usd).div(total).times(100).toFixed(2),
  }));
  if (rest.length) {
    const restUsd = rest.reduce((sum, row) => sum.plus(decimal(row.usd)), decimal(0));
    slices.push({
      code: "LAINNYA",
      name: "Lainnya",
      description: `${rest.length} kode lainnya pada level yang sama`,
      valueMn: millionUsdString(restUsd.toFixed(2)),
      sharePct: restUsd.div(total).times(100).toFixed(2),
    });
  }
  return slices;
}

export function rankGrowth(current: CommodityValue[], previous: CommodityValue[], limit = 5) {
  const prior = new Map(previous.map((row) => [row.code, row]));
  return current
    .map((row) => {
      const before = prior.get(row.code);
      return {
        code: row.code,
        description: row.description,
        valueMn: row.usd == null ? null : millionUsdString(row.usd),
        growthPct: growthRate(row.usd, before?.usd ?? null),
      };
    })
    .filter((row): row is { code: string; description: string; valueMn: string | null; growthPct: string } => row.growthPct != null)
    .sort((left, right) => decimal(right.growthPct).comparedTo(decimal(left.growthPct)))
    .slice(0, limit);
}

export function topCommodities(
  rows: Array<{ code: string; description: string; exportUsd: string | null; importUsd: string | null }>,
  flow: "export" | "import",
  limit = 10,
) {
  const key = flow === "export" ? "exportUsd" : "importUsd";
  return [...rows]
    .filter((row) => row[key] != null)
    .sort((left, right) => decimal(right[key] as string).comparedTo(decimal(left[key] as string)))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      code: row.code,
      description: row.description,
      exportMn: row.exportUsd == null ? null : millionUsdString(row.exportUsd),
      importMn: row.importUsd == null ? null : millionUsdString(row.importUsd),
    }));
}
