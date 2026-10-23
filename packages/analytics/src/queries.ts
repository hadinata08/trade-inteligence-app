import { Prisma } from "@prisma/client";
import { getPrisma } from "@iti/database";
import {
  CUMULATIVE_2026,
  compareTotalWithLevel,
  cumulativeMonths,
  growthRate,
  decimal,
  millionUsdString,
  tradeBalance,
} from "@iti/shared";
import { compositionSlices, parseHsLevel, parsePeriods, rankGrowth, sumPeriods, topCommodities, type HsLevel } from "./dashboard-view";

export async function getDatasetBanner() {
  const prisma = getPrisma();
  const meta = await prisma.datasetMeta.findUnique({ where: { id: 1 } });
  const fixtureRows = await prisma.tradeObservation.count({ where: { sourceKind: "FIXTURE" } });
  const liveRows = await prisma.tradeObservation.count({ where: { sourceKind: "UN_COMTRADE" } });
  return {
    sourceKind: fixtureRows > 0 ? "FIXTURE" : liveRows > 0 ? "UN_COMTRADE" : "EMPTY",
    mixed: fixtureRows > 0 && liveRows > 0,
    fixtureRows,
    liveRows,
    notes: meta?.notes ?? null,
    hs8Status: meta?.hs8Status ?? "UNVERIFIED",
    hs8Note: meta?.hs8Note ?? null,
    lastSyncedAt: meta?.lastSyncedAt?.toISOString() ?? null,
    classification: meta?.classificationLabel ?? "HS / H6",
  };
}

export async function listPeriodOptions() {
  const prisma = getPrisma();
  const periods = await prisma.reportingPeriod.findMany({ orderBy: [{ year: "asc" }, { month: "asc" }] });
  const options = periods.map((period) => ({
    code: period.periodCode,
    label: period.month ? `${period.year}-${String(period.month).padStart(2, "0")}` : String(period.year),
    kind: period.frequency,
  }));
  if (periods.some((period) => period.year === 2026 && period.frequency === "MONTHLY")) {
    options.push({ code: CUMULATIVE_2026.code, label: CUMULATIVE_2026.label, kind: "ANNUAL" });
  }
  return options;
}

export type TradeViewOptions = {
  /** Kode M49; "0" = agregat World. */
  partnerCode: string;
  /** Periode terpilih (tahun, bulan, atau kode kumulatif 2026). */
  periods: string[];
  hsLevel: HsLevel;
  /** Kode HS opsional. Kartu dan riwayat memakai nilai kode ini; komposisi dibatasi ke turunannya. */
  hsCode?: string | null;
};

/** Memperluas kode kumulatif 2026 menjadi delapan kode bulanan. */
function expandPeriods(periods: string[]): string[] {
  const codes = periods.flatMap((code) =>
    code === CUMULATIVE_2026.code ? CUMULATIVE_2026.months.map((month) => `2026${String(month).padStart(2, "0")}`) : [code],
  );
  return [...new Set(codes)];
}

/**
 * Satu tampilan perdagangan untuk satu negara (atau World), beberapa periode, satu level HS, dan kode HS opsional.
 * Dipakai bersama oleh Dasbor dan halaman Negara Mitra agar angka keduanya selalu sama.
 */
export async function getTradeView(options: TradeViewOptions) {
  const prisma = getPrisma();
  const hsCode = options.hsCode && /^\d{2,8}$/.test(options.hsCode) ? options.hsCode : null;
  const sourceCodes = expandPeriods(options.periods);
  const annualSelected = sourceCodes.filter((code) => /^\d{4}$/.test(code));
  const latest = sourceCodes.length === 1 || annualSelected.length === sourceCodes.length ? annualSelected.at(-1) ?? null : null;
  const previous = latest ? previousAnnual(latest) : null;

  const totalsFor = async (codes: string[]) => {
    if (!codes.length) return new Map<string, { exportUsd: string | null; importUsd: string | null }>();
    if (!hsCode) {
      const rows = await prisma.partnerPeriodSummary.findMany({
        where: { partnerCode: options.partnerCode, period: { periodCode: { in: codes } } },
        include: { period: true },
      });
      return new Map(rows.map((row) => [row.period.periodCode, {
        exportUsd: row.exportPresent === false ? null : row.exportUsd?.toString() ?? null,
        importUsd: row.importPresent === false ? null : row.importUsd?.toString() ?? null,
      }]));
    }
    const rows = await commodityTotals(options.partnerCode, codes, hsCode);
    return new Map(rows.map((row) => [row.period_code, { exportUsd: row.export_usd, importUsd: row.import_usd }]));
  };

  const annualCodes = (await prisma.reportingPeriod.findMany({ where: { frequency: "ANNUAL" }, orderBy: { year: "asc" } })).map((row) => row.periodCode);
  const history = await totalsFor(annualCodes);
  const selectedTotals = await totalsFor(sourceCodes.filter((code) => !history.has(code)));
  const valueOf = (code: string) => history.get(code) ?? selectedTotals.get(code) ?? { exportUsd: null, importUsd: null };
  const exportUsd = sumPeriods(sourceCodes.map((code) => valueOf(code).exportUsd));
  const importUsd = sumPeriods(sourceCodes.map((code) => valueOf(code).importUsd));
  const headline = headlineFrom(
    exportUsd,
    importUsd,
    latest && previous ? valueOf(previous).exportUsd : null,
    latest && previous ? valueOf(previous).importUsd : null,
  );
  // Pertumbuhan hanya bermakna untuk satu tahun terakhir terhadap tahun sebelumnya.
  const growthExportPct = latest && previous ? growthRate(valueOf(latest).exportUsd, valueOf(previous).exportUsd) : null;
  const growthImportPct = latest && previous ? growthRate(valueOf(latest).importUsd, valueOf(previous).importUsd) : null;

  const annual = annualCodes.map((code) => {
    const value = valueOf(code);
    return {
      period: code,
      exportMn: value.exportUsd ? millionUsdString(value.exportUsd) : null,
      importMn: value.importUsd ? millionUsdString(value.importUsd) : null,
      balanceMn: moneyBalance(value.exportUsd, value.importUsd),
    };
  });

  const level = commodityLevelFor(options.hsLevel, hsCode);
  const current = level ? await loadCommodityLevel(options.partnerCode, sourceCodes, level, hsCode) : { basis: "unavailable" as const, rows: [] };
  const prior = level && latest && previous ? await loadCommodityLevel(options.partnerCode, [previous], level, hsCode) : { basis: "unavailable" as const, rows: [] };
  const currentLatest = level && latest && sourceCodes.length > 1 ? await loadCommodityLevel(options.partnerCode, [latest], level, hsCode) : current;

  return {
    partnerCode: options.partnerCode,
    sourcePeriods: sourceCodes,
    latestPeriod: latest,
    growthBasePeriod: latest ? previous : null,
    hsLevel: options.hsLevel,
    commodityLevel: level,
    hsCode,
    headline: { ...headline, growthExportPct, growthImportPct },
    annual,
    commodityBasis: current.basis,
    compositionExport: compositionSlices(current.rows.map((row) => ({ code: row.code, description: row.description, usd: row.exportUsd }))),
    compositionImport: compositionSlices(current.rows.map((row) => ({ code: row.code, description: row.description, usd: row.importUsd }))),
    growthCommodities: rankGrowth(
      currentLatest.rows.map((row) => ({ code: row.code, description: row.description, usd: row.exportUsd })),
      prior.rows
        .filter((row) => row.exportUsd != null && decimal(row.exportUsd).greaterThanOrEqualTo(1_000_000))
        .map((row) => ({ code: row.code, description: row.description, usd: row.exportUsd })),
    ),
    topExportCommodities: topCommodities(current.rows, "export"),
    topImportCommodities: topCommodities(current.rows, "import"),
  };
}

/** Level komposisi: level yang dipilih, tetapi selalu di bawah kode HS yang difilter. */
function commodityLevelFor(level: HsLevel, hsCode: string | null): HsLevel | null {
  if (!hsCode) return level;
  const next = hsCode.length + 2;
  if (next > 6) return null;
  return (Math.max(level, next) as HsLevel);
}

export async function getDashboard(input: { periods?: string | string[]; hs?: string; country?: string; hsCode?: string } = {}) {
  const prisma = getPrisma();
  const banner = await getDatasetBanner();
  const periods = await listPeriodOptions();
  const annual = periods.filter((period) => /^\d{4}$/.test(period.code));
  const selected = parsePeriods(input.periods, periods.map((period) => period.code), annual.at(-1)?.code ?? periods[0]?.code);
  const hsLevel = parseHsLevel(input.hs);
  const partners = await listPartnerOptions();
  const country = input.country && (input.country === "0" || partners.some((partner) => partner.code === input.country)) ? input.country : "0";
  const view = await getTradeView({ partnerCode: country, periods: selected, hsLevel, hsCode: input.hsCode });
  const rankPeriods = view.sourcePeriods;
  const partnerCount = await prisma.partnerPeriodSummary.count({
    where: {
      partnerCode: { not: "0" },
      period: { periodCode: rankPeriods.at(-1) ?? "" },
      OR: [{ exportPresent: true }, { importPresent: true }],
    },
  });
  const topExport = country === "0" ? await topPartners(rankPeriods, "export") : [];
  const topImport = country === "0" ? await topPartners(rankPeriods, "import") : [];
  const coverage = await coverageSummary();
  return {
    banner,
    periods,
    partners,
    country,
    countryName: country === "0" ? "World (agregat resmi)" : partners.find((partner) => partner.code === country)?.name ?? country,
    selected,
    ...view,
    headline: { ...view.headline, partnerCount, usesWorldAggregate: country === "0", coverage },
    topExport,
    topImport,
  };
}

export async function listPartnerOptions() {
  const prisma = getPrisma();
  const rows = await prisma.partner.findMany({
    where: { entityType: { in: ["COUNTRY", "TERRITORY"] } },
    orderBy: { partnerName: "asc" },
    select: { m49Code: true, partnerName: true },
  });
  return rows.map((row) => ({ code: row.m49Code, name: row.partnerName }));
}

/** Kode HS2 dan HS4 untuk daftar pilihan filter kode HS. */
export async function listHsOptions() {
  const prisma = getPrisma();
  const rows = await prisma.hsCommodity.findMany({
    where: { hsLevel: { in: [2, 4] }, hsCode: { not: "TOTAL" } },
    orderBy: { hsCode: "asc" },
    select: { hsCode: true, description: true },
    distinct: ["hsCode"],
  });
  return rows.map((row) => ({ code: row.hsCode, description: row.description }));
}

function headlineFrom(exportUsd: string | null, importUsd: string | null, previousExport: string | null, previousImport: string | null) {
  return {
    exportUsd,
    importUsd,
    balanceUsd: tradeBalance(exportUsd, importUsd),
    exportMn: exportUsd ? millionUsdString(exportUsd) : null,
    importMn: importUsd ? millionUsdString(importUsd) : null,
    balanceMn: tradeBalance(exportUsd, importUsd) ? millionUsdString(tradeBalance(exportUsd, importUsd) as string) : null,
    growthExportPct: growthRate(exportUsd, previousExport),
    growthImportPct: growthRate(importUsd, previousImport),
  };
}

function previousAnnual(code: string): string | null {
  if (!/^\d{4}$/.test(code)) return null;
  return String(Number(code) - 1);
}

async function topPartners(periodCodes: string[], flow: "export" | "import") {
  const prisma = getPrisma();
  const codes = expandPeriods(periodCodes);
  const rows = await prisma.partnerPeriodSummary.findMany({
    where: { period: { periodCode: { in: codes } }, partnerCode: { not: "0" } },
    include: { partner: true },
  });
  const byPartner = new Map<string, { name: string; values: Array<string | null> }>();
  for (const row of rows) {
    const entry = byPartner.get(row.partnerCode) ?? { name: row.partner.partnerName, values: [] };
    entry.values.push((flow === "export" ? row.exportUsd : row.importUsd)?.toString() ?? null);
    byPartner.set(row.partnerCode, entry);
  }
  return [...byPartner.entries()]
    .map(([code, entry]) => {
      // Mitra tanpa salah satu periode tidak diberi angka parsial pada peringkat gabungan.
      const usd = entry.values.length === codes.length ? sumPeriods(entry.values) : null;
      return { code, name: entry.name, valueMn: usd ? millionUsdString(usd) : null };
    })
    .filter((row) => row.valueMn != null)
    .sort((a, b) => Number(b.valueMn) - Number(a.valueMn))
    .slice(0, 10);
}

/** Total satu kode HS per periode untuk satu negara, atau World (resmi bila ada, selain itu jumlah bilateral). */
async function commodityTotals(partnerCode: string, periodCodes: string[], hsCode: string) {
  const prisma = getPrisma();
  const periods = Prisma.join(periodCodes);
  if (partnerCode !== "0") {
    return prisma.$queryRaw<Array<{ period_code: string; export_usd: string | null; import_usd: string | null }>>`
      SELECT p.period_code,
             SUM(s.export_usd) FILTER (WHERE s.export_present)::text AS export_usd,
             SUM(s.import_usd) FILTER (WHERE s.import_present)::text AS import_usd
      FROM commodity_period_summaries s
      JOIN reporting_periods p ON p.id = s.period_id
      WHERE s.partner_code = ${partnerCode} AND s.hs_code = ${hsCode} AND p.period_code IN (${periods})
      GROUP BY p.period_code
    `;
  }
  return prisma.$queryRaw<Array<{ period_code: string; export_usd: string | null; import_usd: string | null }>>`
    WITH rows AS (
      SELECT p.period_code, s.partner_code = '0' AS official,
             SUM(s.export_usd) FILTER (WHERE s.export_present) AS export_usd,
             SUM(s.import_usd) FILTER (WHERE s.import_present) AS import_usd
      FROM commodity_period_summaries s
      JOIN reporting_periods p ON p.id = s.period_id
      WHERE s.hs_code = ${hsCode} AND p.period_code IN (${periods})
      GROUP BY p.period_code, s.partner_code = '0'
    )
    SELECT DISTINCT ON (period_code) period_code, export_usd::text AS export_usd, import_usd::text AS import_usd
    FROM rows
    ORDER BY period_code, official DESC
  `;
}

async function loadCommodityLevel(partnerCode: string, periodCodes: string[], hsLevel: HsLevel, prefix: string | null = null) {
  const prisma = getPrisma();
  const periodRows = await prisma.reportingPeriod.findMany({ where: { periodCode: { in: periodCodes } }, select: { id: true } });
  if (!periodRows.length) return { basis: "unavailable" as const, rows: [] };
  const ids = periodRows.map((period) => period.id);
  let basis: "world" | "bilateral" | "partner" = "partner";
  let partnerSql = Prisma.sql`s.partner_code = ${partnerCode}`;
  if (partnerCode === "0") {
    // Agregat World resmi hanya dipakai bila tersedia untuk semua periode terpilih; selain itu jumlah bilateral.
    const official = await prisma.commodityPeriodSummary.groupBy({ by: ["periodId"], where: { partnerCode: "0", periodId: { in: ids }, hsLevel } });
    basis = official.length === ids.length ? "world" : "bilateral";
    partnerSql = basis === "world" ? Prisma.sql`s.partner_code = '0'` : Prisma.sql`s.partner_code <> '0'`;
  }
  const prefixSql = prefix ? Prisma.sql`AND s.hs_code LIKE ${`${prefix}%`}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ hs_code: string; description: string; export_usd: string | null; import_usd: string | null }>>`
    SELECT s.hs_code,
           MIN(c.description) AS description,
           SUM(s.export_usd) FILTER (WHERE s.export_present)::text AS export_usd,
           SUM(s.import_usd) FILTER (WHERE s.import_present)::text AS import_usd
    FROM commodity_period_summaries s
    JOIN hs_commodities c ON c.id = s.commodity_id
    WHERE s.period_id IN (${Prisma.join(ids)})
      AND s.hs_level = ${hsLevel}
      AND ${partnerSql}
      ${prefixSql}
    GROUP BY s.hs_code
  `;
  return {
    basis,
    rows: rows.map((row) => ({
      code: row.hs_code,
      description: row.description,
      exportUsd: row.export_usd,
      importUsd: row.import_usd,
    })),
  };
}

export async function listCountries(query: { q?: string; page?: number; period?: string }) {
  const prisma = getPrisma();
  const page = Math.max(1, query.page ?? 1);
  const take = 25;
  const where = {
    entityType: { in: ["COUNTRY" as const, "TERRITORY" as const] },
    ...(query.q
      ? {
          OR: [
            { partnerName: { contains: query.q, mode: "insensitive" as const } },
            { m49Code: { contains: query.q } },
            { iso3: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.partner.count({ where }),
    prisma.partner.findMany({
      where,
      orderBy: { partnerName: "asc" },
      skip: (page - 1) * take,
      take,
    }),
  ]);
  const period = query.period && query.period !== CUMULATIVE_2026.code ? query.period : "2024";
  const summaries = await prisma.partnerPeriodSummary.findMany({
    where: { partnerCode: { in: rows.map((row) => row.m49Code) }, period: { periodCode: period } },
  });
  const byCode = new Map(summaries.map((row) => [row.partnerCode, row]));
  return {
    page,
    pageSize: take,
    total,
    period,
    rows: rows.map((row) => {
      const summary = byCode.get(row.m49Code);
      const exportUsd = summary?.exportUsd?.toString() ?? null;
      const importUsd = summary?.importUsd?.toString() ?? null;
      return {
        code: row.m49Code,
        name: row.partnerName,
        iso3: row.iso3,
        region: row.region,
        entityType: row.entityType,
        exportMn: exportUsd ? millionUsdString(exportUsd) : null,
        importMn: importUsd ? millionUsdString(importUsd) : null,
        balanceMn: tradeBalance(exportUsd, importUsd) ? millionUsdString(tradeBalance(exportUsd, importUsd) as string) : null,
        completeness: summary?.completeness ?? "MISSING",
      };
    }),
  };
}

export async function getCountry(code: string, periodCode?: string) {
  const prisma = getPrisma();
  const partner = await prisma.partner.findUnique({ where: { m49Code: code } });
  if (!partner) return null;
  const annual = await prisma.partnerPeriodSummary.findMany({
    where: { partnerCode: code, period: { frequency: "ANNUAL" } },
    include: { period: true },
    orderBy: { period: { year: "asc" } },
  });
  const selected = periodCode && periodCode !== CUMULATIVE_2026.code ? periodCode : annual.at(-1)?.period.periodCode ?? "2024";
  const chapters = await prisma.commodityPeriodSummary.findMany({
    where: { partnerCode: code, hsLevel: 2, period: { periodCode: selected } },
    include: { commodity: true },
    orderBy: { hsCode: "asc" },
  });
  const monthly = await prisma.partnerPeriodSummary.findMany({
    where: { partnerCode: code, period: { year: 2026, frequency: "MONTHLY", month: { lte: 8 } } },
    include: { period: true },
  });
  const cumulative = cumulativeMonths(
    CUMULATIVE_2026.months.map((month) => {
      const row = monthly.find((item) => item.period.month === month);
      return {
        month,
        exportUsd: row?.exportPresent ? row.exportUsd?.toString() ?? null : null,
        importUsd: row?.importPresent ? row.importUsd?.toString() ?? null : null,
        verified: Boolean(row),
      };
    }),
  );
  return {
    partner: {
      code: partner.m49Code,
      name: partner.partnerName,
      iso2: partner.iso2,
      iso3: partner.iso3,
      region: partner.region,
      entityType: partner.entityType,
    },
    selected,
    annual: annual.map((row) => ({
      period: row.period.periodCode,
      exportMn: row.exportUsd ? millionUsdString(row.exportUsd.toString()) : null,
      importMn: row.importUsd ? millionUsdString(row.importUsd.toString()) : null,
      balanceMn: moneyBalance(row.exportUsd?.toString() ?? null, row.importUsd?.toString() ?? null),
      completeness: row.completeness,
    })),
    chapters: chapters.map((row) => ({
      hsCode: row.hsCode,
      description: row.commodity.description,
      exportMn: row.exportPresent && row.exportUsd ? millionUsdString(row.exportUsd.toString()) : null,
      importMn: row.importPresent && row.importUsd ? millionUsdString(row.importUsd.toString()) : null,
      balanceMn: moneyBalance(row.exportPresent ? row.exportUsd?.toString() ?? null : null, row.importPresent ? row.importUsd?.toString() ?? null : null),
    })),
    cumulative: {
      status: cumulative.status,
      exportMn: cumulative.exportUsd ? millionUsdString(cumulative.exportUsd) : null,
      importMn: cumulative.importUsd ? millionUsdString(cumulative.importUsd) : null,
      monthsMissing: cumulative.monthsMissing,
      disclosedPartialExportMn: cumulative.disclosedPartialExportUsd ? millionUsdString(cumulative.disclosedPartialExportUsd) : null,
    },
  };
}

export async function getCommodityChildren(partnerCode: string, parentCode: string | null, periodCode: string) {
  const prisma = getPrisma();
  const rows = await prisma.commodityPeriodSummary.findMany({
    where: {
      partnerCode,
      period: { periodCode },
      commodity: { parentCode: parentCode && parentCode.length ? parentCode : null, hsLevel: parentCode ? undefined : 2 },
    },
    include: { commodity: true },
    orderBy: { hsCode: "asc" },
    take: 200,
  });
  const level = parentCode ? parentCode.length + 2 : 2;
  return rows
    .filter((row) => (parentCode ? row.commodity.parentCode === parentCode : row.hsLevel === 2))
    .filter((row) => !parentCode || row.hsLevel === Math.min(level, 8))
    .map((row) => ({
      hsCode: row.hsCode,
      level: row.hsLevel,
      parentCode: row.commodity.parentCode,
      description: row.commodity.description,
      exportMn: row.exportPresent && row.exportUsd ? millionUsdString(row.exportUsd.toString()) : null,
      importMn: row.importPresent && row.importUsd ? millionUsdString(row.importUsd.toString()) : null,
    }));
}

export async function searchCommodities(query: { q?: string; level?: number; page?: number }) {
  const prisma = getPrisma();
  const page = Math.max(1, query.page ?? 1);
  const take = 30;
  const where = {
    hsCode: { not: "TOTAL" },
    ...(query.level ? { hsLevel: query.level } : {}),
    ...(query.q
      ? {
          OR: [
            { hsCode: { startsWith: query.q } },
            { description: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.hsCommodity.count({ where }),
    prisma.hsCommodity.findMany({ where, orderBy: { hsCode: "asc" }, skip: (page - 1) * take, take }),
  ]);
  return {
    page,
    pageSize: take,
    total,
    rows: rows.map((row) => ({
      hsCode: row.hsCode,
      level: row.hsLevel,
      parentCode: row.parentCode,
      description: row.description,
    })),
  };
}

export async function compareCountries(codes: string[], periodCode: string) {
  const prisma = getPrisma();
  const rows = await prisma.partnerPeriodSummary.findMany({
    where: { partnerCode: { in: codes }, period: { periodCode } },
    include: { partner: true },
  });
  return rows.map((row) => ({
    code: row.partnerCode,
    name: row.partner.partnerName,
    exportMn: row.exportUsd ? millionUsdString(row.exportUsd.toString()) : null,
    importMn: row.importUsd ? millionUsdString(row.importUsd.toString()) : null,
    balanceMn: moneyBalance(row.exportUsd?.toString() ?? null, row.importUsd?.toString() ?? null),
    completeness: row.completeness,
  }));
}

export async function getCoverage() {
  const prisma = getPrisma();
  const banner = await getDatasetBanner();
  const partners = await prisma.partner.count({ where: { entityType: { in: ["COUNTRY", "TERRITORY"] }, activeStatus: true } });
  const periods = await prisma.reportingPeriod.count();
  const checkpoints = await prisma.syncCheckpoint.groupBy({ by: ["completenessStatus"], _count: { _all: true } });
  const totalComplete = await prisma.partnerPeriodSummary.count({ where: { partnerCode: { not: "0" }, completeness: "COMPLETE" } });
  const totalPartial = await prisma.partnerPeriodSummary.count({ where: { partnerCode: { not: "0" }, completeness: "PARTIAL" } });
  const hs = await prisma.commodityPeriodSummary.groupBy({ by: ["hsLevel"], _count: { _all: true } });
  const sampleGap = await sampleTotalGap();
  return {
    banner,
    partners,
    periods,
    checkpoints: Object.fromEntries(checkpoints.map((row) => [row.completenessStatus, row._count._all])),
    totalComplete,
    totalPartial,
    hsLevels: Object.fromEntries(hs.map((row) => [row.hsLevel, row._count._all])),
    totalVsHs2: sampleGap,
  };
}

async function sampleTotalGap() {
  const prisma = getPrisma();
  const period = await prisma.reportingPeriod.findFirst({ where: { frequency: "ANNUAL" }, orderBy: { year: "desc" } });
  if (!period) return null;
  const world = await prisma.partnerPeriodSummary.findFirst({ where: { partnerCode: "0", periodId: period.id } });
  const hs2 = await prisma.commodityPeriodSummary.findMany({
    where: { partnerCode: "0", periodId: period.id, hsLevel: 2, exportPresent: true },
  });
  if (!hs2.length) return { period: period.periodCode, comparable: false, differenceMn: null };
  const sum = hs2.reduce((acc, row) => acc + Number(row.exportUsd?.toString() ?? 0), 0);
  const compared = compareTotalWithLevel(world?.exportUsd?.toString() ?? null, sum ? sum.toFixed(2) : null);
  return {
    period: period.periodCode,
    comparable: compared.comparable,
    differenceMn: compared.differenceUsd ? millionUsdString(compared.differenceUsd) : null,
  };
}

async function coverageSummary() {
  const prisma = getPrisma();
  const partners = await prisma.partner.count({ where: { entityType: { in: ["COUNTRY", "TERRITORY"] }, activeStatus: true } });
  const periods = await prisma.reportingPeriod.count();
  const complete = await prisma.partnerPeriodSummary.count({ where: { partnerCode: { not: "0" }, completeness: "COMPLETE" } });
  const expected = partners * periods;
  return {
    percent: expected ? Math.round((complete / expected) * 1000) / 10 : 0,
    complete,
    expected,
  };
}

export async function getSyncOverview() {
  const prisma = getPrisma();
  const banner = await getDatasetBanner();
  const pausedSetting = await prisma.appSetting.findUnique({ where: { key: "sync_paused" } });
  const grouped = await prisma.syncJob.groupBy({ by: ["status"], _count: { _all: true } });
  const stages = await prisma.syncJob.groupBy({ by: ["stage", "status"], _count: { _all: true } });
  const failed = await prisma.syncJob.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 8 });
  const exports = await prisma.exportJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  const usage = await prisma.apiUsage.count({ where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  const budget = Number(process.env.COMTRADE_DAILY_REQUEST_BUDGET || 450);
  return {
    banner,
    paused: Boolean(pausedSetting && typeof pausedSetting.value === "object" && pausedSetting.value && (pausedSetting.value as { paused?: boolean }).paused),
    apiKeyConfigured: Boolean(process.env.COMTRADE_API_KEY),
    quotaUsed: usage,
    quotaRemaining: Math.max(0, budget - usage),
    quotaBudget: budget,
    jobs: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
    stages: stages.map((row) => ({ stage: row.stage, status: row.status, count: row._count._all })),
    failed: failed.map((job) => ({ id: job.jobId, stage: job.stage, error: job.errorMessage, attempts: job.attempts })),
    exports: exports.map((job) => ({
      id: job.exportId,
      status: job.status,
      progress: job.progress,
      fileName: job.fileName,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function listExports() {
  const prisma = getPrisma();
  const rows = await prisma.exportJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((job) => ({
    id: job.exportId,
    status: job.status,
    progress: job.progress,
    fileName: job.fileName,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    requestedBy: job.requestedBy,
  }));
}

function moneyBalance(exportUsd: string | null, importUsd: string | null): string | null {
  const balance = tradeBalance(exportUsd, importUsd);
  return balance == null ? null : millionUsdString(balance);
}
