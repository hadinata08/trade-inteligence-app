import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { ExportFilters } from "@iti/shared";
import { Prisma } from "@prisma/client";
import { ANNUAL_YEARS, CUMULATIVE_2026, allSourcePeriodCodes, annualPeriodCode, periodLabel } from "@iti/shared";
import { getPrisma } from "@iti/database";
import { planVolumes, type CommodityRow, type MoneyRow, type WorkbookInput, type WorkbookPartner, type WorkbookPeriod } from "./model";
import { writeTradeWorkbook } from "./workbook";

export type ExportProgress = {
  stage: string;
  countriesCompleted: number;
  countriesTotal: number;
  rowsGenerated: number;
  bytes: number;
  warnings: string[];
};

export async function generateExportPackage(options: {
  filters: ExportFilters;
  outputDir: string;
  onProgress?: (progress: ExportProgress) => Promise<void> | void;
}): Promise<{ filePath: string; fileName: string; warnings: string[]; bytes: number }> {
  const prisma = getPrisma();
  const meta = await prisma.datasetMeta.findUnique({ where: { id: 1 } });
  const fixtureRows = await prisma.tradeObservation.count({ where: { sourceKind: "FIXTURE" } });
  const liveRows = await prisma.tradeObservation.count({ where: { sourceKind: "UN_COMTRADE" } });
  const partners = await prisma.partner.findMany({ orderBy: { partnerName: "asc" } });
  const selected = partners.filter((partner) => {
    if (partner.entityType === "AGGREGATE") return false;
    // Kode mitra kosong berarti seluruh negara, sama dengan dasbor situs.
    if (options.filters.allPartners || options.filters.preset === "full" || options.filters.partnerCodes.length === 0) return partner.activeStatus;
    return options.filters.partnerCodes.includes(partner.m49Code);
  });
  const requested = options.filters.periods.length
    ? options.filters.periods
    : [...allSourcePeriodCodes(), CUMULATIVE_2026.code];
  const periods = buildPeriods(requested);
  const sourceCodes = periods.filter((period) => period.kind !== "CUMULATIVE").map((period) => period.code);
  const periodRows = await prisma.reportingPeriod.findMany({ where: { periodCode: { in: sourceCodes } } });
  const periodIds = new Map(periodRows.map((period) => [period.periodCode, period.id]));
  const summaries = await prisma.partnerPeriodSummary.findMany({
    where: {
      partnerCode: { in: [...selected.map((partner) => partner.m49Code), "0"] },
      period: { periodCode: { in: sourceCodes } },
    },
    include: { period: true },
  });
  const totals: MoneyRow[] = summaries.map((row) => ({
    partnerCode: row.partnerCode,
    periodCode: row.period.periodCode,
    exportUsd: row.exportUsd?.toString() ?? null,
    importUsd: row.importUsd?.toString() ?? null,
    completeness: row.completeness,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
  }));
  const levels = options.filters.hsLevels.filter((level) => level !== 8 || options.filters.includeHs8);
  const counts = await prisma.tradeObservation.groupBy({
    by: ["partnerCode"],
    where: {
      partnerCode: { in: selected.map((partner) => partner.m49Code) },
      periodId: { in: [...periodIds.values()] },
      aggregationLevel: { in: levels },
    },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((row) => [row.partnerCode, row._count._all]));
  const plan = planVolumes(selected.map((partner) => ({ code: partner.m49Code, rows: (countMap.get(partner.m49Code) ?? sourceCodes.length) + sourceCodes.length })));
  const warnings = buildWarnings(meta?.notes, fixtureRows, liveRows, meta?.hs8Status ?? "UNVERIFIED", plan.singleWorkbook, plan.overflowPartners.length);
  await mkdir(options.outputDir, { recursive: true });
  const files: string[] = [];
  let rowsGenerated = 0;
  let countriesCompleted = 0;
  for (const volume of plan.files) {
    const volumePartners = selected.filter((partner) => volume.partnerCodes.includes(partner.m49Code));
    const world = partners.filter((partner) => partner.m49Code === "0");
    const commodities = options.filters.includeDetail ? await loadCommodities(volumePartners.map((partner) => partner.m49Code), [...periodIds.values()], levels) : [];
    const helper = commodities.filter((row) => row.level === 2 || row.level === 4);
    const chart = await loadChartContext([...volumePartners.map((partner) => partner.m49Code), "0"], sourceCodes);
    const input: WorkbookInput = {
      generatedAt: new Date().toISOString(),
      sourceLabel: sourceLabel(fixtureRows, liveRows),
      sourceKind: fixtureRows > 0 && liveRows > 0 ? "MIXED" : fixtureRows > 0 ? "FIXTURE" : liveRows > 0 ? "UN_COMTRADE" : "EMPTY",
      classification: meta?.classificationLabel ?? "HS / H6",
      lastSyncedAt: meta?.lastSyncedAt?.toISOString() ?? null,
      coveragePercent: coveragePercent(selected.length, sourceCodes.length, totals),
      warnings,
      hs8Status: meta?.hs8Status ?? "UNVERIFIED",
      partners: toPartners([...world, ...volumePartners]),
      periods,
      totals: totals.filter((row) => volume.partnerCodes.includes(row.partnerCode) || row.partnerCode === "0"),
      chartTotals: chart.totals.filter((row) => volume.partnerCodes.includes(row.partnerCode) || row.partnerCode === "0"),
      chartPeriods: chart.periods,
      commodities,
      helperCommodities: helper,
      chartCommodities: chart.commodities,
      levelTotals: chart.levelTotals,
      cumulative: periods.some((period) => period.kind === "CUMULATIVE") ? { label: CUMULATIVE_2026.label, monthCodes: [...CUMULATIVE_2026.months].map((month) => `2026${String(month).padStart(2, "0")}`) } : null,
      includeCharts: volume.primary && options.filters.includeCharts,
      includeDetail: options.filters.includeDetail,
      includeCoverage: volume.primary && options.filters.includeCoverage,
    };
    const filename = volume.primary ? "INDONESIA_TRADE_INTELLIGENCE.xlsx" : `INDONESIA_TRADE_VOLUME_${files.length}.xlsx`;
    const full = path.join(options.outputDir, filename);
    await options.onProgress?.({
      stage: `Menulis ${volumePartners.length} negara`,
      countriesCompleted,
      countriesTotal: selected.length,
      rowsGenerated,
      bytes: 0,
      warnings,
    });
    const written = await writeTradeWorkbook(full, input);
    rowsGenerated += written.rows;
    countriesCompleted += volume.partnerCodes.length;
    files.push(full);
    await options.onProgress?.({
      stage: volume.primary ? "Workbook utama" : `Volume ${files.length}`,
      countriesCompleted,
      countriesTotal: selected.length,
      rowsGenerated,
      bytes: (await stat(full)).size,
      warnings,
    });
  }
  if (!plan.singleWorkbook) {
    warnings.push("Satu berkas workbook tidak cukup untuk seluruh detail tanpa melampaui batas praktis Excel. Paket ini berisi beberapa workbook dan manifes.");
    const manifest = {
      generatedAt: new Date().toISOString(),
      singleWorkbook: false,
      reason: "Row volume exceeded the practical single-workbook limit or a country exceeded the Excel row limit.",
      files: files.map((file) => path.basename(file)),
      overflowPartners: plan.overflowPartners,
      warnings,
    };
    await writeFile(path.join(options.outputDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
    const zip = new JSZip();
    for (const file of files) zip.file(path.basename(file), await readFileBuffer(file));
    zip.file("MANIFEST.json", JSON.stringify(manifest, null, 2));
    const zipPath = path.join(options.outputDir, "INDONESIA_TRADE_INTELLIGENCE_PACKAGE.zip");
    await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const bytes = (await stat(zipPath)).size;
    return { filePath: zipPath, fileName: path.basename(zipPath), warnings, bytes };
  }
  const only = files[0] ?? path.join(options.outputDir, "INDONESIA_TRADE_INTELLIGENCE.xlsx");
  return { filePath: only, fileName: path.basename(only), warnings, bytes: (await stat(only)).size };
}

type ChartContext = {
  totals: MoneyRow[];
  periods: WorkbookPeriod[];
  commodities: CommodityRow[];
  levelTotals: NonNullable<WorkbookInput["levelTotals"]>;
};

async function loadChartContext(
  partnerCodes: string[],
  sourceCodes: string[],
): Promise<ChartContext> {
  const annualCodes = ANNUAL_YEARS.map((year) => annualPeriodCode(year));
  const missing = annualCodes.filter((code) => !sourceCodes.includes(code));
  const periods = missing.map((code) => ({ code, label: periodLabel(code), kind: "ANNUAL" as const }));
  const codes = partnerCodes.filter((code) => code.length > 0);
  const rankPeriods = [...new Set([...annualCodes, ...sourceCodes])];
  if (!codes.length) return { totals: [], periods, commodities: [], levelTotals: {} };
  const prisma = getPrisma();
  const extraTotals = missing.length
    ? await prisma.partnerPeriodSummary.findMany({
        where: { partnerCode: { in: codes }, period: { periodCode: { in: missing } } },
        include: { period: true },
      })
    : [];
  const totals: MoneyRow[] = extraTotals.map(toMoneyRow);
  const ranked = await loadRankedCommodities(codes.filter((code) => code !== "0"), rankPeriods);
  return { totals, periods, commodities: ranked.rows, levelTotals: ranked.levelTotals };
}

function toMoneyRow(row: {
  partnerCode: string;
  period: { periodCode: string };
  exportUsd: Prisma.Decimal | null;
  importUsd: Prisma.Decimal | null;
  completeness: string;
  sourceUpdatedAt: Date | null;
}): MoneyRow {
  return {
    partnerCode: row.partnerCode,
    periodCode: row.period.periodCode,
    exportUsd: row.exportUsd?.toString() ?? null,
    importUsd: row.importUsd?.toString() ?? null,
    completeness: row.completeness,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
  };
}

/**
 * Basis World per periode dan level HS: baris resmi partner '0' bila ada, selain itu jumlah bilateral SELURUH mitra.
 * Aturan ini sama dengan dasbor situs, sehingga komposisi dan pertumbuhan di Excel tidak bergantung pada negara yang diekspor.
 */
function worldBase(periods: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    official AS (
      SELECT p.period_code, s.hs_level, s.hs_code,
             MIN(c.description) AS description,
             SUM(s.export_usd) FILTER (WHERE s.export_present) AS export_usd,
             SUM(s.import_usd) FILTER (WHERE s.import_present) AS import_usd
      FROM commodity_period_summaries s
      JOIN reporting_periods p ON p.id = s.period_id
      JOIN hs_commodities c ON c.id = s.commodity_id
      WHERE s.partner_code = '0' AND p.period_code IN (${periods}) AND s.hs_level IN (2, 4, 6)
      GROUP BY p.period_code, s.hs_level, s.hs_code
    ),
    bilateral AS (
      SELECT p.period_code, s.hs_level, s.hs_code,
             MIN(c.description) AS description,
             SUM(s.export_usd) FILTER (WHERE s.export_present) AS export_usd,
             SUM(s.import_usd) FILTER (WHERE s.import_present) AS import_usd
      FROM commodity_period_summaries s
      JOIN reporting_periods p ON p.id = s.period_id
      JOIN hs_commodities c ON c.id = s.commodity_id
      WHERE s.partner_code <> '0' AND p.period_code IN (${periods}) AND s.hs_level IN (2, 4, 6)
      GROUP BY p.period_code, s.hs_level, s.hs_code
    ),
    base AS (
      SELECT * FROM official
      UNION ALL
      SELECT b.* FROM bilateral b
      WHERE NOT EXISTS (SELECT 1 FROM official o WHERE o.period_code = b.period_code AND o.hs_level = b.hs_level)
    )`;
}

const GROWTH_SQL = (scope: Prisma.Sql) => Prisma.sql`
    grown AS (
      SELECT cur.partner_code, cur.period_code, cur.hs_level, cur.hs_code, cur.description, cur.export_usd, cur.import_usd,
             prev.period_code AS prev_period, prev.export_usd AS prev_export, prev.import_usd AS prev_import, prev.description AS prev_description,
             ROW_NUMBER() OVER (
               PARTITION BY cur.partner_code, cur.period_code, cur.hs_level
               ORDER BY ((cur.export_usd - prev.export_usd) / ABS(prev.export_usd)) DESC
             ) AS rg
      FROM ${scope} cur
      JOIN ${scope} prev
        ON prev.partner_code = cur.partner_code
       AND prev.hs_code = cur.hs_code
       AND prev.hs_level = cur.hs_level
       AND prev.period_code = (cur.period_code::int - 1)::text
      WHERE prev.export_usd >= 1000000
        AND cur.export_usd IS NOT NULL
        AND cur.period_code ~ '^[0-9]{4}$'
    )
    SELECT partner_code, period_code, hs_level, hs_code, description, export_usd::text AS export_usd, import_usd::text AS import_usd,
           prev_period, prev_export::text AS prev_export, prev_import::text AS prev_import, prev_description
    FROM grown
    WHERE rg <= 5`;

async function loadRankedCommodities(
  partnerCodes: string[],
  periodCodes: string[],
): Promise<{ rows: CommodityRow[]; levelTotals: NonNullable<WorkbookInput["levelTotals"]> }> {
  if (!periodCodes.length) return { rows: [], levelTotals: {} };
  const prisma = getPrisma();
  const periods = Prisma.join(periodCodes);
  const partnerRows: RankSqlRow[] = [];
  const partnerGrowth: RankSqlRow[] = [];
  const partnerTotals: TotalSqlRow[] = [];
  if (partnerCodes.length) {
    const partners = Prisma.join(partnerCodes);
    const partnerBase = Prisma.sql`
      base AS (
        SELECT s.partner_code, p.period_code, s.hs_level, s.hs_code,
               MIN(c.description) AS description,
               SUM(s.export_usd) FILTER (WHERE s.export_present) AS export_usd,
               SUM(s.import_usd) FILTER (WHERE s.import_present) AS import_usd
        FROM commodity_period_summaries s
        JOIN reporting_periods p ON p.id = s.period_id
        JOIN hs_commodities c ON c.id = s.commodity_id
        WHERE s.partner_code IN (${partners})
          AND p.period_code IN (${periods})
          AND s.hs_level IN (2, 4, 6)
        GROUP BY s.partner_code, p.period_code, s.hs_level, s.hs_code
      )`;
    partnerRows.push(...(await prisma.$queryRaw<RankSqlRow[]>`
      WITH ${partnerBase},
      ranked AS (
        SELECT base.*,
               ROW_NUMBER() OVER (PARTITION BY partner_code, period_code, hs_level ORDER BY export_usd DESC NULLS LAST) AS rx,
               ROW_NUMBER() OVER (PARTITION BY partner_code, period_code, hs_level ORDER BY import_usd DESC NULLS LAST) AS rm
        FROM base
      )
      SELECT partner_code, period_code, hs_level, hs_code, description, export_usd::text AS export_usd, import_usd::text AS import_usd
      FROM ranked
      WHERE rx <= 12 OR rm <= 12 OR hs_level = 2
    `));
    partnerGrowth.push(...(await prisma.$queryRaw<RankSqlRow[]>`WITH ${partnerBase}, ${GROWTH_SQL(Prisma.sql`base`)}`));
    partnerTotals.push(...(await prisma.$queryRaw<TotalSqlRow[]>`
      WITH ${partnerBase}
      SELECT partner_code, period_code, hs_level, SUM(export_usd)::text AS export_usd, SUM(import_usd)::text AS import_usd
      FROM base
      GROUP BY partner_code, period_code, hs_level
    `));
  }
  const world = Prisma.sql`${worldBase(periods)}, world AS (SELECT '0'::text AS partner_code, base.* FROM base)`;
  const worldRows = await prisma.$queryRaw<RankSqlRow[]>`
    WITH ${world},
    ranked AS (
      SELECT world.*,
             ROW_NUMBER() OVER (PARTITION BY period_code, hs_level ORDER BY export_usd DESC NULLS LAST) AS rx,
             ROW_NUMBER() OVER (PARTITION BY period_code, hs_level ORDER BY import_usd DESC NULLS LAST) AS rm
      FROM world
    )
    SELECT partner_code, period_code, hs_level, hs_code, description, export_usd::text AS export_usd, import_usd::text AS import_usd
    FROM ranked
    WHERE rx <= 12 OR rm <= 12 OR hs_level = 2
  `;
  const worldGrowth = await prisma.$queryRaw<RankSqlRow[]>`WITH ${world}, ${GROWTH_SQL(Prisma.sql`world`)}`;
  const worldTotals = await prisma.$queryRaw<TotalSqlRow[]>`
    WITH ${world}
    SELECT partner_code, period_code, hs_level, SUM(export_usd)::text AS export_usd, SUM(import_usd)::text AS import_usd
    FROM world
    GROUP BY partner_code, period_code, hs_level
  `;
  const merged = new Map<string, CommodityRow>();
  const add = (row: RankSqlRow, partnerCode = row.partner_code, periodCode = row.period_code, exportUsd = row.export_usd, importUsd = row.import_usd, description = row.description) => {
    const key = `${partnerCode}|${periodCode}|${row.hs_code}`;
    merged.set(key, {
      partnerCode,
      periodCode,
      hsCode: row.hs_code,
      level: Number(row.hs_level),
      parentCode: null,
      description: description ?? row.hs_code,
      exportUsd,
      importUsd,
      sourceStatus: "REPORTED",
    });
  };
  for (const row of [...partnerRows, ...worldRows]) add(row);
  for (const row of [...partnerGrowth, ...worldGrowth]) {
    add(row);
    if (row.prev_period) {
      add({ ...row, period_code: row.prev_period }, row.partner_code, row.prev_period, row.prev_export ?? null, row.prev_import ?? null, row.prev_description ?? row.description);
    }
  }
  const levelTotals: NonNullable<WorkbookInput["levelTotals"]> = {};
  for (const row of [...partnerTotals, ...worldTotals]) {
    levelTotals[`${row.partner_code}|${row.period_code}|${Number(row.hs_level)}`] = { exportUsd: row.export_usd, importUsd: row.import_usd };
  }
  return { rows: [...merged.values()], levelTotals };
}

type TotalSqlRow = { partner_code: string; period_code: string; hs_level: number; export_usd: string | null; import_usd: string | null };

type RankSqlRow = {
  partner_code: string;
  period_code: string;
  hs_level: number;
  hs_code: string;
  description: string | null;
  export_usd: string | null;
  import_usd: string | null;
  prev_period?: string | null;
  prev_export?: string | null;
  prev_import?: string | null;
  prev_description?: string | null;
};

async function loadCommodities(partnerCodes: string[], periodIds: string[], levels: number[]): Promise<CommodityRow[]> {
  if (!partnerCodes.length || !periodIds.length) return [];
  const prisma = getPrisma();
  const observations = await prisma.tradeObservation.findMany({
    where: { partnerCode: { in: partnerCodes }, periodId: { in: periodIds }, aggregationLevel: { in: levels } },
    include: { commodity: true, period: true },
  });
  const grouped = new Map<string, CommodityRow>();
  for (const observation of observations) {
    const key = `${observation.partnerCode}|${observation.period.periodCode}|${observation.commodity.hsCode}`;
    const current = grouped.get(key) ?? {
      partnerCode: observation.partnerCode,
      periodCode: observation.period.periodCode,
      hsCode: observation.commodity.hsCode,
      level: observation.commodity.hsLevel,
      parentCode: observation.commodity.parentCode,
      description: observation.commodity.description,
      exportUsd: null,
      importUsd: null,
      sourceStatus: observation.sourceStatus,
    };
    const amount = observation.tradeValueUsd.toString();
    if (observation.flow === "EXPORT") current.exportUsd = amount;
    if (observation.flow === "IMPORT") current.importUsd = amount;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function buildPeriods(codes: string[]): WorkbookPeriod[] {
  const periods: WorkbookPeriod[] = [];
  for (const code of codes) {
    if (code === CUMULATIVE_2026.code) {
      periods.push({ code, label: CUMULATIVE_2026.label, kind: "CUMULATIVE" });
      continue;
    }
    periods.push({
      code,
      label: periodLabel(code),
      kind: code.length === 6 ? "MONTHLY" : "ANNUAL",
    });
  }
  return periods;
}

function toPartners(rows: Array<{ m49Code: string; partnerName: string; entityType: string }>): WorkbookPartner[] {
  return rows.map((row) => ({
    code: row.m49Code,
    name: row.partnerName,
    aggregate: row.entityType === "AGGREGATE" || row.m49Code === "0",
  }));
}

function coveragePercent(partners: number, periods: number, totals: MoneyRow[]): number {
  const expected = partners * periods;
  if (!expected) return 0;
  const complete = totals.filter((row) => row.partnerCode !== "0" && row.completeness === "COMPLETE").length;
  return Math.round((complete / expected) * 1000) / 10;
}

function sourceLabel(fixtureRows: number, liveRows: number): string {
  if (fixtureRows > 0 && liveRows === 0) return "DATA CONTOH — bukan UN Comtrade";
  if (fixtureRows > 0 && liveRows > 0) return "CAMPURAN — sebagian data contoh, sebagian UN Comtrade";
  if (liveRows > 0) return "UN Comtrade Plus";
  return "Belum ada data";
}

function buildWarnings(
  notes: string | null | undefined,
  fixtureRows: number,
  liveRows: number,
  hs8Status: string,
  singleWorkbook: boolean,
  overflow: number,
): string[] {
  const warnings: string[] = [];
  if (notes) warnings.push(notes);
  if (fixtureRows > 0) warnings.push("Observasi bertanda FIXTURE bukan statistik resmi.");
  if (liveRows === 0) warnings.push("Belum ada observasi UN Comtrade yang tersimpan.");
  if (hs8Status !== "COMPLETE") warnings.push(`HS8: ${hs8Status}. Tarif line hanya ditampilkan bila sumber benar-benar menyediakan data.`);
  if (!singleWorkbook) warnings.push("Paket multi-workbook: kendala satu berkas tidak dapat dipertahankan.");
  if (overflow) warnings.push(`${overflow} negara melampaui batas baris Excel dan dipecah ke lembar tambahan.`);
  return warnings;
}

async function readFileBuffer(file: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(file);
}
