import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { orderHierarchically, outlineLevelFor } from "@iti/shared";
import {
  SHEET,
  buildCompositionGrid,
  buildLevelBoard,
  buildSheetName,
  commodityLabel,
  partnerLabel,
  statusText,
  toMillionNumber,
  topCommodities,
  type CommodityRow,
  type MoneyRow,
  type WorkbookInput,
  type WorkbookPartner,
} from "./model";
import { injectCharts, type ChartSpec } from "./ooxml";

const NAVY = "FF1B3A2F";
const COPPER = "FFC4622D";
const PAPER = "FFFFFBF5";
const CREAM = "FFF4EFE4";
const INK = "FF1C241F";
const MUTED = "FF5E6A62";
const WHITE = "FFFFFFFF";
const GAP = "FFF7F1E8";

// Baris data pertama tiap tabel. Judul bagian ada dua baris di atasnya, header kolom satu baris di atasnya.
const TOP_CMD_ROW = 103;
const TOP_CMD_IMPORT_ROW = 117;
const GROWTH_ROW = 131;

export type WrittenWorkbook = {
  sheets: string[];
  rows: number;
  warnings: string[];
  charts: number;
  sheetNames: Record<string, string>;
};

export async function writeTradeWorkbook(filename: string, input: WorkbookInput): Promise<WrittenWorkbook> {
  await mkdir(path.dirname(filename), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Indonesia Trade Intelligence";
  workbook.lastModifiedBy = "Indonesia Trade Intelligence";
  workbook.created = new Date(input.generatedAt);
  workbook.modified = new Date(input.generatedAt);
  workbook.title = "Indonesia Trade Intelligence";
  workbook.subject = input.sourceLabel;
  workbook.calcProperties = { fullCalcOnLoad: true };

  const warnings = [...input.warnings];
  const dropdownPartners = uniquePartners(input);
  const periodLabels = input.periods.map((period) => period.label);
  const helperLabels = uniqueCommodityLabels(input.helperCommodities);
  const labelOf = (code: string) => input.periods.find((period) => period.code === code)?.label ?? code;
  const names = new Map(dropdownPartners.map((partner) => [partner.code, partnerLabel(partner)]));

  const trendPeriods = annualChartPeriods(input);
  const rankSource = [
    ...(input.commodities.some((row) => row.level === 2 || row.level === 4 || row.level === 6) ? input.commodities : input.helperCommodities),
    ...(input.chartCommodities ?? []),
  ];
  const levelRanks = buildLevelBoard(rankSource, dropdownPartners, boardPeriods(input), input.levelTotals);
  const cmdRanks = topCommodities(input.helperCommodities, dropdownPartners, labelOf);
  const dashboard = workbook.addWorksheet(SHEET.dashboard);
  writeDashboard(dashboard, input, dropdownPartners, helperLabels, warnings);

  const summary = workbook.addWorksheet(SHEET.summary);
  writeSummary(summary, input, names, labelOf);

  const used = new Set<string>([SHEET.dashboard.toLowerCase(), SHEET.summary.toLowerCase(), SHEET.coverage.toLowerCase()]);
  const sheetNames: Record<string, string> = {};
  let rows = 0;
  const countryPartners = input.partners.filter((partner) => !partner.aggregate);
  const commoditiesByPartner = groupCommodities(input.commodities);
  for (let index = 0; index < countryPartners.length; index += 1) {
    const partner = countryPartners[index];
    if (!partner) continue;
    const name = buildSheetName(index + 3, partner.name, partner.code, used);
    sheetNames[partner.code] = name;
    const sheet = workbook.addWorksheet(name);
    rows += await writeCountry(sheet, partner, input, name, commoditiesByPartner.get(partner.code));
    if (index % 4 === 3) await yieldToEventLoop();
  }

  if (input.includeCoverage) writeCoverage(workbook.addWorksheet(SHEET.coverage), input, countryPartners, sheetNames);

  const lookups = workbook.addWorksheet(SHEET.lookups);
  writeLookups(lookups, dropdownPartners, periodLabels, helperLabels);
  const totalsSheet = workbook.addWorksheet(SHEET.totals);
  const totalRange = writeTotals(totalsSheet, input, names);
  const hsSheet = workbook.addWorksheet(SHEET.hs);
  const hsRange = writeHelperCommodities(hsSheet, input, names, labelOf);
  const trends = workbook.addWorksheet(SHEET.trends);
  writeTrends(trends, trendPeriods);
  const rankCmd = workbook.addWorksheet(SHEET.rankCmd);
  writeCommandRanks(rankCmd, cmdRanks);
  const levelSheet = workbook.addWorksheet(SHEET.level);
  writeLevelBoard(levelSheet, levelRanks);
  // Banyak negara: pie memakai kode HS2 lengkap dan peringkat atas, bukan setiap baris detail.
  const compositionSource = countryPartners.length > 8 && input.chartCommodities?.length ? input.chartCommodities : rankSource;
  const composition = buildCompositionGrid(compositionSource, dropdownPartners, trendPeriods);
  const compSheet = workbook.addWorksheet(SHEET.comp);
  const compRange = writeComposition(compSheet, composition, trendPeriods);
  const view = workbook.addWorksheet(SHEET.view);
  writeView(view);
  addNames(workbook, totalRange, hsRange, Math.max(trendPeriods.length, 1), Math.max(cmdRanks.length, 1), compRange);

  for (const sheetName of [SHEET.lookups, SHEET.totals, SHEET.hs, SHEET.trends, SHEET.rankCmd, SHEET.level, SHEET.comp, SHEET.view]) {
    const sheet = workbook.getWorksheet(sheetName);
    if (sheet) sheet.state = "hidden";
  }

  await yieldToEventLoop();
  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(filename, Buffer.from(buffer));

  const charts = input.includeCharts ? resolveChartRefs(workbook, buildCharts(trendPeriods, input, levelRanks)) : [];
  if (charts.length) await injectCharts(filename, SHEET.dashboard, charts);

  const visible = workbook.worksheets.filter((sheet) => sheet.state === "visible").map((sheet) => sheet.name);
  return { sheets: visible, rows, warnings, charts: charts.length, sheetNames };
}

function uniquePartners(input: WorkbookInput): WorkbookPartner[] {
  const map = new Map<string, WorkbookPartner>();
  for (const row of input.totals) {
    if (!map.has(row.partnerCode)) {
      const known = input.partners.find((partner) => partner.code === row.partnerCode);
      map.set(row.partnerCode, known ?? { code: row.partnerCode, name: row.partnerCode === "0" ? "World" : row.partnerCode, aggregate: row.partnerCode === "0" });
    }
  }
  for (const partner of input.partners) map.set(partner.code, partner);
  return [...map.values()];
}

function uniqueCommodityLabels(rows: CommodityRow[]): string[] {
  const labels = new Map<string, string>();
  for (const row of rows) {
    if (row.level === 0 || row.hsCode === "TOTAL") continue;
    if (!labels.has(row.hsCode)) labels.set(row.hsCode, commodityLabel(row.hsCode, row.description));
  }
  return ["TOTAL", ...[...labels.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, label]) => label)];
}

function writeLookups(sheet: ExcelJS.Worksheet, partners: WorkbookPartner[], periods: string[], commodities: string[]) {
  const levels = ["HS2", "HS4", "HS6"];
  sheet.addRow(["Negara", "Periode", "Komoditas", "Level HS"]);
  const height = Math.max(partners.length, periods.length, commodities.length, levels.length, 1);
  for (let index = 0; index < height; index += 1) {
    sheet.addRow([partners[index] ? partnerLabel(partners[index]) : null, periods[index] ?? null, commodities[index] ?? null, levels[index] ?? null]);
  }
  sheet.getColumn(1).width = 36;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 56;
  sheet.getColumn(4).width = 12;
}

function writeTotals(
  sheet: ExcelJS.Worksheet,
  input: WorkbookInput,
  names: Map<string, string>,
): { last: number } {
  sheet.addRow(["Negara", "Kode", "Periode", "KodePeriode", "EksporUSD", "ImporUSD", "StatusEkspor", "StatusImpor", "Kelengkapan", "Diperbarui", "EksporJuta", "ImporJuta"]);
  const addresses = new Map<string, { exportCell: string; importCell: string }>();
  const partners = [...new Set(input.totals.map((row) => row.partnerCode))];
  const sourcePeriods = input.periods.filter((period) => period.kind !== "CUMULATIVE");
  const extraPeriods = (input.chartPeriods ?? []).filter((period) => !sourcePeriods.some((item) => item.code === period.code));
  for (const partnerCode of partners) {
    for (const period of sourcePeriods) {
      const found = input.totals.find((row) => row.partnerCode === partnerCode && row.periodCode === period.code);
      const row = sheet.addRow([
        names.get(partnerCode) ?? partnerCode,
        partnerCode,
        period.label,
        period.code,
        found?.exportUsd == null ? null : Number(found.exportUsd),
        found?.importUsd == null ? null : Number(found.importUsd),
        found?.exportUsd == null ? "MISSING" : "PRESENT",
        found?.importUsd == null ? "MISSING" : "PRESENT",
        found?.completeness ?? "MISSING",
        found?.sourceUpdatedAt ?? null,
      ]);
      const excelRow = row.number;
      row.getCell(11).value = { formula: `IF(E${excelRow}="","",E${excelRow}/1000000)` };
      row.getCell(12).value = { formula: `IF(F${excelRow}="","",F${excelRow}/1000000)` };
      row.getCell(2).numFmt = "@";
      if (period.kind === "MONTHLY") {
        addresses.set(`${partnerCode}|${period.code}`, { exportCell: `E${excelRow}`, importCell: `F${excelRow}` });
      }
    }
    for (const period of extraPeriods) {
      const found = (input.chartTotals ?? []).find((row) => row.partnerCode === partnerCode && row.periodCode === period.code);
      const row = sheet.addRow([
        names.get(partnerCode) ?? partnerCode,
        partnerCode,
        period.label,
        period.code,
        found?.exportUsd == null ? null : Number(found.exportUsd),
        found?.importUsd == null ? null : Number(found.importUsd),
        found?.exportUsd == null ? "MISSING" : "PRESENT",
        found?.importUsd == null ? "MISSING" : "PRESENT",
        found?.completeness ?? "MISSING",
        found?.sourceUpdatedAt ?? null,
      ]);
      const excelRow = row.number;
      row.getCell(11).value = { formula: `IF(E${excelRow}="","",E${excelRow}/1000000)` };
      row.getCell(12).value = { formula: `IF(F${excelRow}="","",F${excelRow}/1000000)` };
      row.getCell(2).numFmt = "@";
    }
    if (input.cumulative) writeCumulativeTotal(sheet, partnerCode, names.get(partnerCode) ?? partnerCode, input.cumulative, addresses);
  }
  if (sheet.rowCount < 2) sheet.addRow([]);
  sheet.getColumn(2).numFmt = "@";
  return { last: Math.max(sheet.rowCount, 2) };
}

function writeCumulativeTotal(
  sheet: ExcelJS.Worksheet,
  partnerCode: string,
  label: string,
  cumulative: { label: string; monthCodes: string[] },
  addresses: Map<string, { exportCell: string; importCell: string }>,
) {
  const exportRefs = cumulative.monthCodes.map((code) => addresses.get(`${partnerCode}|${code}`)?.exportCell).filter((cell): cell is string => Boolean(cell));
  const importRefs = cumulative.monthCodes.map((code) => addresses.get(`${partnerCode}|${code}`)?.importCell).filter((cell): cell is string => Boolean(cell));
  const required = cumulative.monthCodes.length;
  const row = sheet.addRow([label, partnerCode, cumulative.label, "CUMULATIVE", null, null, null, null, null, null]);
  const excelRow = row.number;
  row.getCell(5).value = gatedSum(exportRefs, required);
  row.getCell(6).value = gatedSum(importRefs, required);
  row.getCell(7).value = { formula: `IF(E${excelRow}="","MISSING","PRESENT")` };
  row.getCell(8).value = { formula: `IF(F${excelRow}="","MISSING","PRESENT")` };
  row.getCell(9).value = {
    formula: `IF(AND(${countExpr(exportRefs)}=${required},${countExpr(importRefs)}=${required}),"COMPLETE",IF(AND(${countExpr(exportRefs)}=0,${countExpr(importRefs)}=0),"MISSING","PARTIAL"))`,
  };
  row.getCell(11).value = { formula: `IF(E${excelRow}="","",E${excelRow}/1000000)` };
  row.getCell(12).value = { formula: `IF(F${excelRow}="","",F${excelRow}/1000000)` };
  row.getCell(2).numFmt = "@";
}

function writeHelperCommodities(
  sheet: ExcelJS.Worksheet,
  input: WorkbookInput,
  names: Map<string, string>,
  labelOf: (code: string) => string,
): { last: number } {
  sheet.addRow(["Negara", "Kode", "Periode", "HsCode", "Level", "EksporUSD", "ImporUSD", "StatusEkspor", "StatusImpor", "Deskripsi", "EksporJuta", "ImporJuta"]);
  for (const row of input.helperCommodities) {
    if (row.hsCode === "TOTAL" || row.level === 0) continue;
    const added = sheet.addRow([
      names.get(row.partnerCode) ?? row.partnerCode,
      row.partnerCode,
      labelOf(row.periodCode),
      row.hsCode,
      row.level,
      row.exportUsd == null ? null : Number(row.exportUsd),
      row.importUsd == null ? null : Number(row.importUsd),
      row.exportUsd == null ? "MISSING" : "PRESENT",
      row.importUsd == null ? "MISSING" : "PRESENT",
      row.description,
    ]);
    const excelRow = added.number;
    added.getCell(4).numFmt = "@";
    added.getCell(2).numFmt = "@";
    added.getCell(11).value = { formula: `IF(F${excelRow}="","",F${excelRow}/1000000)` };
    added.getCell(12).value = { formula: `IF(G${excelRow}="","",G${excelRow}/1000000)` };
  }
  if (sheet.rowCount < 2) sheet.addRow([]);
  return { last: Math.max(sheet.rowCount, 2) };
}

function writeTrends(sheet: ExcelJS.Worksheet, periods: WorkbookInput["periods"]) {
  sheet.addRow(["Kode", "Periode", "Ekspor", "Impor", "Neraca"]);
  const rows = periods.length ? periods : [{ code: "", label: "", kind: "ANNUAL" as const }];
  for (const period of rows) {
    const row = sheet.addRow([period.code, period.label]);
    const excelRow = row.number;
    // Grafik tren selalu menggambar seluruh tahun agar rentangnya sama dengan situs; pilihan Ya hanya memengaruhi KPI.
    row.getCell(3).value = { formula: kpiFormula("Ekspor", `B${excelRow}`) };
    row.getCell(4).value = { formula: kpiFormula("Impor", `B${excelRow}`) };
    row.getCell(5).value = { formula: `IF(OR(ISNA(C${excelRow}),ISNA(D${excelRow})),NA(),C${excelRow}-D${excelRow})` };
  }
}

const YEAR_SLOTS = 8;
/** Panjang maksimum uraian HS pada label grafik. */
const LABEL_CHARS = 30;
const YEAR_FIRST_ROW = 6;
/** Peringkat komposisi di _VIEW. Pie memakai 8 teratas; tabel memakai 10. */
const EXPORT_RANK_ROW = 50;
const IMPORT_RANK_ROW = 70;

function kpiFormula(flow: "Ekspor" | "Impor", periodCell: string, onlyIfSelected = false): string {
  const status = flow === "Ekspor" ? "TotExpStatus" : "TotImpStatus";
  const values = flow === "Ekspor" ? "TotExpMn" : "TotImpMn";
  const hsStatus = flow === "Ekspor" ? "HsExpStatus" : "HsImpStatus";
  const hsValues = flow === "Ekspor" ? "HsExpMn" : "HsImpMn";
  const value = `IF(FilterHsCode="TOTAL",IF(COUNTIFS(TotName,FilterCountry,TotPeriod,${periodCell},${status},"PRESENT")=0,NA(),SUMIFS(${values},TotName,FilterCountry,TotPeriod,${periodCell})),IF(COUNTIFS(HsName,FilterCountry,HsPeriod,${periodCell},HsCode,FilterHsCode,${hsStatus},"PRESENT")=0,NA(),SUMIFS(${hsValues},HsName,FilterCountry,HsPeriod,${periodCell},HsCode,FilterHsCode)))`;
  if (!onlyIfSelected) return value;
  return `IF(COUNTIFS(YearLabel,${periodCell},YearPick,"Ya")=0,NA(),${value})`;
}

function writeCommandRanks(sheet: ExcelJS.Worksheet, rows: Array<{ key: string; description: string; value: number | null }>) {
  sheet.addRow(["Kunci", "Komoditas", "EksporJuta"]);
  if (!rows.length) {
    sheet.addRow([null, null, null]);
    return;
  }
  for (const row of rows) sheet.addRow([row.key, row.description, row.value]);
}

function latestSelectedYearFormula(): string {
  let formula = '""';
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) {
    const row = YEAR_FIRST_ROW + slot;
    formula = `IF(H${row}="Ya",G${row},${formula})`;
  }
  return formula;
}

/** Daftar tahun Ya, mis. "2024, 2025, 2026". Tanpa TEXTJOIN agar Excel tidak menampilkan #NAME?. */
function selectedYearsFormula(): string {
  const pieces: string[] = [];
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) {
    const row = YEAR_FIRST_ROW + slot;
    pieces.push(`IF(H${row}="Ya",G${row}&", ","")`);
  }
  const joined = pieces.join("&");
  return `IF(LEN(${joined})<2,"",LEFT(${joined},LEN(${joined})-2))`;
}

function writeYearPicker(sheet: ExcelJS.Worksheet, input: WorkbookInput) {
  const years = annualChartPeriods(input);
  label(sheet, "G5", "Periode");
  label(sheet, "H5", "Pilih");
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 12;
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) {
    const row = YEAR_FIRST_ROW + slot;
    const year = years[slot];
    const yearCell = sheet.getCell(`G${row}`);
    const pickCell = sheet.getCell(`H${row}`);
    yearCell.border = border();
    pickCell.border = border();
    yearCell.font = { name: "Calibri" };
    pickCell.font = { name: "Calibri", bold: true };
    if (!year) continue;
    yearCell.value = year.label;
    yearCell.numFmt = "@";
    pickCell.value = slot === years.length - 1 ? "Ya" : "Tidak";
    pickCell.fill = solid("FFFFF4CC");
    pickCell.dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Ya,Tidak"'],
      showErrorMessage: true,
      errorTitle: "Pilihan tahun",
      error: "Isi Ya atau Tidak. Beberapa tahun boleh Ya sekaligus.",
    };
  }
}

function writeDashboard(
  sheet: ExcelJS.Worksheet,
  input: WorkbookInput,
  partners: WorkbookPartner[],
  commodities: string[],
  warnings: string[],
) {
  sheet.properties.tabColor = { argb: COPPER };
  sheet.mergeCells("A1:L1");
  sheet.getCell("A1").value = "INDONESIA TRADE INTELLIGENCE";
  sheet.getCell("A1").font = { name: "Calibri", size: 22, bold: true, color: { argb: WHITE } };
  sheet.getCell("A1").fill = solid(NAVY);
  sheet.getRow(1).height = 32;
  sheet.mergeCells("A2:L2");
  sheet.getCell("A2").value = "Perdagangan barang internasional Indonesia — nilai dalam juta USD. Dasbor ini bekerja di Microsoft Excel tanpa koneksi ke situs.";
  sheet.getCell("A2").font = { name: "Calibri", size: 11, color: { argb: INK } };
  sheet.getCell("A2").fill = solid(CREAM);

  label(sheet, "A5", "Negara");
  label(sheet, "A6", "Tahun aktif");
  label(sheet, "A7", "Komoditas");
  label(sheet, "A8", "Kode HS");
  label(sheet, "A9", "Level HS");
  const country = partners.find((partner) => partner.code === "0") ?? partners[0];
  sheet.getCell("B5").value = country ? partnerLabel(country) : "";
  sheet.getCell("B6").value = { formula: selectedYearsFormula() };
  sheet.getCell("B6").alignment = { vertical: "middle", wrapText: true };
  // Tahun tunggal untuk kunci komposisi, peringkat, dan pertumbuhan. Disembunyikan agar Tahun aktif bisa menampilkan daftar.
  sheet.getCell("AA6").value = { formula: latestSelectedYearFormula() };
  sheet.getColumn(27).hidden = true;
  sheet.getCell("B7").value = "TOTAL";
  sheet.getCell("B8").value = { formula: 'IF(B7="TOTAL","TOTAL",TRIM(LEFT(B7,FIND(" — ",B7&" — ")-1)))' };
  sheet.getCell("B9").value = "HS2";
  writeYearPicker(sheet, input);
  for (const address of ["B5", "B6", "B7", "B9"]) {
    sheet.getCell(address).fill = solid("FFFFF4CC");
    sheet.getCell(address).border = border();
    sheet.getCell(address).font = { name: "Calibri", bold: true };
  }
  const lastPartner = Math.max(partners.length + 1, 2);
  const lastCommodity = Math.max(commodities.length + 1, 2);
  validation(sheet.getCell("B5"), `'${SHEET.lookups}'!$A$2:$A$${lastPartner}`);
  validation(sheet.getCell("B7"), `'${SHEET.lookups}'!$C$2:$C$${lastCommodity}`);
  validation(sheet.getCell("B9"), `'${SHEET.lookups}'!$D$2:$D$4`);

  // Kartu ringkasan (KPI): label di atas, nilai besar di bawah, masing-masing selebar kolom D:E.
  kpiCard(sheet, 5, "Total ekspor (juta USD)", 'IF(COUNTIF(YearPick,"Ya")=0,"n.a.",IF(COUNT(YearExport)<COUNTIF(YearPick,"Ya"),"n.a.",SUM(YearExport)))', "#,##0.00", "FFC4622D");
  kpiCard(sheet, 7, "Total impor (juta USD)", 'IF(COUNTIF(YearPick,"Ya")=0,"n.a.",IF(COUNT(YearImport)<COUNTIF(YearPick,"Ya"),"n.a.",SUM(YearImport)))', "#,##0.00", NAVY);
  kpiCard(sheet, 9, { formula: 'IF(OR(D10="n.a.",D10="",NOT(ISNUMBER(D10))),"Surplus / defisit neraca (juta USD)",IF(D10>=0,"Surplus neraca (juta USD)","Defisit neraca (juta USD)"))' }, 'IF(OR(D6="n.a.",D8="n.a.",D6="",D8=""),"n.a.",D6-D8)', "#,##0.00", "FF1F7A4D");
  kpiCard(sheet, 11, "Pertumbuhan ekspor (%) tahun aktif vs tahun sebelumnya", 'IF(OR(ISNA(LatestExport),LatestExport="",FilterPrevPeriod=""),"n.a.",IF(FilterHsCode="TOTAL",IF(COUNTIFS(TotName,FilterCountry,TotPeriod,FilterPrevPeriod,TotExpStatus,"PRESENT")=0,"n.a.",IF(SUMIFS(TotExpMn,TotName,FilterCountry,TotPeriod,FilterPrevPeriod)=0,"n.a.",(LatestExport-SUMIFS(TotExpMn,TotName,FilterCountry,TotPeriod,FilterPrevPeriod))/ABS(SUMIFS(TotExpMn,TotName,FilterCountry,TotPeriod,FilterPrevPeriod)))),IF(COUNTIFS(HsName,FilterCountry,HsPeriod,FilterPrevPeriod,HsCode,FilterHsCode,HsExpStatus,"PRESENT")=0,"n.a.",IF(SUMIFS(HsExpMn,HsName,FilterCountry,HsPeriod,FilterPrevPeriod,HsCode,FilterHsCode)=0,"n.a.",(LatestExport-SUMIFS(HsExpMn,HsName,FilterCountry,HsPeriod,FilterPrevPeriod,HsCode,FilterHsCode))/ABS(SUMIFS(HsExpMn,HsName,FilterCountry,HsPeriod,FilterPrevPeriod,HsCode,FilterHsCode))))))', "0.00%", "FF3D6B8A");

  meta(sheet, "A10", "Sumber", input.sourceLabel);
  meta(sheet, "A11", "Klasifikasi", input.classification);
  meta(sheet, "A12", "Terakhir sinkron", input.lastSyncedAt ?? "Belum ada");
  meta(sheet, "A13", "Cakupan TOTAL", `${input.coveragePercent.toFixed(1)}%`);
  meta(sheet, "A14", "Status HS8", input.hs8Status);
  meta(sheet, "A15", "Jenis data", input.sourceKind);
  sheet.mergeCells("A16:L16");
  sheet.getCell("A16").value = warnings.join(" ") || "Tidak ada peringatan kelengkapan.";
  sheet.getCell("A16").font = { name: "Calibri", color: { argb: input.sourceKind === "UN_COMTRADE" ? INK : "FF8A3B12" }, italic: true };
  sheet.getCell("A16").alignment = { wrapText: true };
  sheet.getRow(16).height = 32;

  sheet.mergeCells("A18:E18");
  sheet.getCell("A18").value = "Pilih beberapa tahun di kolom Pilih: isi Ya. Tahun aktif menampilkan semua tahun Ya, dipisah koma. Total ekspor, impor, pie komposisi, dan 10 komoditas menjumlahkan tahun Ya, sama dengan situs. Tahun yang tidak tersedia membuat total n.a., bukan nol. Grafik tren menampilkan seluruh tahun yang tersedia untuk negara dan kode HS yang dipilih. Pertumbuhan memakai tahun Ya yang paling akhir dibanding tahun sebelumnya. Level HS tidak dijumlahkan menjadi total.";
  sheet.getCell("A18").font = { name: "Calibri", italic: true, color: { argb: MUTED } };

  section(sheet, `A${TOP_CMD_ROW - 2}`, "10 komoditas ekspor pada negara, tahun Ya yang dijumlahkan, dan level HS yang dipilih");
  tableHeader(sheet, TOP_CMD_ROW - 1, ["No", "Kode HS", "Uraian komoditas", "Ekspor (juta USD)", "Impor (juta USD)"]);
  section(sheet, `A${TOP_CMD_IMPORT_ROW - 2}`, "10 komoditas impor pada negara, tahun Ya yang dijumlahkan, dan level HS yang dipilih");
  tableHeader(sheet, TOP_CMD_IMPORT_ROW - 1, ["No", "Kode HS", "Uraian komoditas", "Ekspor (juta USD)", "Impor (juta USD)"]);
  section(sheet, `A${GROWTH_ROW - 2}`, "Top 5 komoditas dengan kenaikan ekspor tertinggi YoY (%) dibanding tahun sebelumnya. Tahun pembanding di bawah 1 juta USD tidak dipakai.");
  tableHeader(sheet, GROWTH_ROW - 1, ["No", "Kode HS", "Uraian komoditas", "Pertumbuhan ekspor (%)"]);
  for (let rank = 1; rank <= 10; rank += 1) {
    writeLevelLine(sheet, TOP_CMD_ROW + rank - 1, rank, "X");
    writeLevelLine(sheet, TOP_CMD_IMPORT_ROW + rank - 1, rank, "M");
  }
  for (let rank = 1; rank <= 5; rank += 1) {
    const row = GROWTH_ROW + rank - 1;
    const key = `FilterCountry&"|"&FilterPeriod&"|"&FilterHsLevel&"|G|${rank}"`;
    sheet.getCell(`A${row}`).value = rank;
    sheet.getCell(`B${row}`).value = { formula: levelText("B", key) };
    sheet.getCell(`C${row}`).value = { formula: levelText("C", key) };
    sheet.getCell(`D${row}`).value = { formula: `IF(B${row}="","",${levelNumber("F", key)})` };
    sheet.getCell(`B${row}`).numFmt = "@";
    sheet.getCell(`D${row}`).numFmt = '#,##0.00"%"';
  }
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 42;
  sheet.getColumn(3).width = 44;
  sheet.getColumn(4).width = 24;
  sheet.getColumn(5).width = 20;
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.orientation = "landscape";
  sheet.headerFooter.oddFooter = "&LIndonesia Trade Intelligence&RJuta USD";
  sheet.views = [{ state: "frozen", ySplit: 3, activeCell: "B5" }];
}

function writeLevelLine(sheet: ExcelJS.Worksheet, row: number, rank: number, flow: "X" | "M") {
  const source = (flow === "X" ? EXPORT_RANK_ROW : IMPORT_RANK_ROW) + rank - 1;
  sheet.getCell(`A${row}`).value = rank;
  sheet.getCell(`B${row}`).value = { formula: `IF('${SHEET.view}'!A${source}="","",'${SHEET.view}'!A${source}&"")` };
  sheet.getCell(`C${row}`).value = { formula: `IF(B${row}="","",'${SHEET.view}'!B${source})` };
  sheet.getCell(`D${row}`).value = { formula: `IF(B${row}="","",IF('${SHEET.view}'!G${source}=1,'${SHEET.view}'!C${source},"n.a."))` };
  sheet.getCell(`E${row}`).value = { formula: `IF(B${row}="","",IF('${SHEET.view}'!H${source}=1,'${SHEET.view}'!D${source},"n.a."))` };
  sheet.getCell(`B${row}`).numFmt = "@";
  sheet.getCell(`D${row}`).numFmt = '#,##0.000';
  sheet.getCell(`E${row}`).numFmt = '#,##0.000';
}

// INDEX atas sel kosong mengembalikan 0. Teks kosong ditulis "", angka kosong ditulis "n.a." (bukan nol).
function levelText(column: string, key: string): string {
  const lookup = `INDEX('${SHEET.level}'!$${column}$2:$${column}$200000,MATCH(${key},'${SHEET.level}'!$A$2:$A$200000,0))`;
  return `IFERROR(IF(${lookup}="","",${lookup}&""),"")`;
}

function levelNumber(column: string, key: string): string {
  const lookup = `INDEX('${SHEET.level}'!$${column}$2:$${column}$200000,MATCH(${key},'${SHEET.level}'!$A$2:$A$200000,0))`;
  return `IFERROR(IF(${lookup}="","n.a.",${lookup}),"n.a.")`;
}

function tableHeader(sheet: ExcelJS.Worksheet, row: number, headers: string[]) {
  headers.forEach((text, index) => {
    const cell = sheet.getRow(row).getCell(index + 1);
    cell.value = text;
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE } };
    cell.fill = solid(NAVY);
    cell.alignment = { vertical: "middle", horizontal: index === 0 ? "center" : "left" };
  });
}

function writeLevelBoard(sheet: ExcelJS.Worksheet, rows: ReturnType<typeof buildLevelBoard>) {
  sheet.addRow(["Kunci", "Kode", "Uraian", "EksporJuta", "ImporJuta", "Pertumbuhan"]);
  if (!rows.length) sheet.addRow(["", "", "", null, null, null]);
  for (const row of rows) {
    const added = sheet.addRow([row.key, row.code, row.description, row.exportMn, row.importMn, row.growthPct]);
    added.getCell(2).numFmt = "@";
  }
}

function writeView(sheet: ExcelJS.Worksheet) {
  sheet.getCell("Z1").value = { formula: 'IF(LEN(FilterPeriod)<>4,"",IF(ISNUMBER(VALUE(FilterPeriod)),TEXT(VALUE(FilterPeriod)-1,"0"),""))' };
  writeRankBlock(sheet, EXPORT_RANK_ROW, 10, "export");
  writeRankBlock(sheet, IMPORT_RANK_ROW, 10, "import");
  for (let rank = 1; rank <= 8; rank += 1) writePieSlice(sheet, 9 + rank, EXPORT_RANK_ROW + rank - 1, "export");
  writeRemainder(sheet, 18, 10, "export");
  for (let rank = 1; rank <= 8; rank += 1) writePieSlice(sheet, 19 + rank, IMPORT_RANK_ROW + rank - 1, "import");
  writeRemainder(sheet, 28, 20, "import");
  for (let rank = 1; rank <= 5; rank += 1) {
    const row = 29 + rank;
    const key = `FilterCountry&"|"&FilterPeriod&"|"&FilterHsLevel&"|G|${rank}"`;
    sheet.getCell(`A${row}`).value = { formula: levelText("B", key) };
    sheet.getCell(`B${row}`).value = { formula: `IF(A${row}="",NA(),IFERROR(INDEX('${SHEET.level}'!$F$2:$F$200000,MATCH(${key},'${SHEET.level}'!$A$2:$A$200000,0)),NA()))` };
    sheet.getCell(`C${row}`).value = { formula: growthLabel(row, key) };
  }
  sheet.getCell("Z2").value = { formula: `IF(FilterPeriod="",NA(),${kpiFormula("Ekspor", "FilterPeriod")})` };
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) {
    const row = 40 + slot;
    const source = YEAR_FIRST_ROW + slot;
    const exportFormula = kpiFormula("Ekspor", `A${row}`);
    const importFormula = kpiFormula("Impor", `A${row}`);
    sheet.getCell(`A${row}`).value = { formula: `'${SHEET.dashboard}'!G${source}` };
    sheet.getCell(`B${row}`).value = { formula: `'${SHEET.dashboard}'!H${source}` };
    sheet.getCell(`C${row}`).value = { formula: `IF(OR(A${row}="",B${row}<>"Ya"),"",IF(ISNA(${exportFormula}),"",${exportFormula}))` };
    sheet.getCell(`D${row}`).value = { formula: `IF(OR(A${row}="",B${row}<>"Ya"),"",IF(ISNA(${importFormula}),"",${importFormula}))` };
  }
}

function writeRankBlock(sheet: ExcelJS.Worksheet, start: number, count: number, flow: "export" | "import") {
  const keyName = flow === "export" ? "CompExpKey" : "CompImpKey";
  for (let rank = 1; rank <= count; rank += 1) {
    const row = start + rank - 1;
    sheet.getCell(`E${row}`).value = { formula: `IFERROR(AGGREGATE(14,6,${keyName}/((CompPartner=FilterCountry)*(CompLevel=FilterHsLevel)),${rank}),NA())` };
    sheet.getCell(`F${row}`).value = { formula: `IF(ISNA(E${row}),NA(),IFERROR(AGGREGATE(15,6,(ROW(${keyName})-ROW(CompFirst)+1)/((CompPartner=FilterCountry)*(CompLevel=FilterHsLevel)*(${keyName}=E${row})),1),NA()))` };
    sheet.getCell(`A${row}`).value = { formula: `IF(ISNA(F${row}),"",IFERROR(INDEX(CompCode,F${row})&"",""))` };
    sheet.getCell(`A${row}`).numFmt = "@";
    sheet.getCell(`B${row}`).value = { formula: `IF(A${row}="","",IFERROR(INDEX(CompDesc,F${row}),""))` };
    sheet.getCell(`C${row}`).value = { formula: `IF(ISNA(F${row}),NA(),IFERROR(INDEX(CompSelExp,F${row}),NA()))` };
    sheet.getCell(`D${row}`).value = { formula: `IF(ISNA(F${row}),NA(),IFERROR(INDEX(CompSelImp,F${row}),NA()))` };
    sheet.getCell(`G${row}`).value = { formula: `IF(ISNA(F${row}),0,IFERROR(INDEX(CompExpPresent,F${row}),0))` };
    sheet.getCell(`H${row}`).value = { formula: `IF(ISNA(F${row}),0,IFERROR(INDEX(CompImpPresent,F${row}),0))` };
  }
}

function writePieSlice(sheet: ExcelJS.Worksheet, row: number, source: number, flow: "export" | "import") {
  const valueColumn = flow === "export" ? "C" : "D";
  sheet.getCell(`A${row}`).value = { formula: `IF(A${source}="","",A${source})` };
  sheet.getCell(`B${row}`).value = { formula: `IF(A${row}="",NA(),${valueColumn}${source})` };
  sheet.getCell(`C${row}`).value = { formula: sliceLabel(row, `B${source}`) };
}

function writeRemainder(sheet: ExcelJS.Worksheet, row: number, firstSlice: number, flow: "export" | "import") {
  const values = flow === "export" ? "CompSelExp" : "CompSelImp";
  const present = flow === "export" ? "CompExpPresent" : "CompImpPresent";
  const total = `SUMPRODUCT((CompPartner=FilterCountry)*(CompLevel=FilterHsLevel)*(${present}=1)*(${values}))`;
  const top = `AGGREGATE(9,6,B${firstSlice}:B${firstSlice + 7})`;
  sheet.getCell(`E${row}`).value = { formula: `IFERROR((${total})-IFERROR(${top},0),0)` };
  sheet.getCell(`A${row}`).value = { formula: `IF(E${row}<0.000001,"","Lainnya")` };
  sheet.getCell(`B${row}`).value = { formula: `IF(A${row}="",NA(),E${row})` };
  sheet.getCell(`C${row}`).value = { formula: sliceLabel(row, `"Kode lainnya pada level yang sama"`) };
}

/**
 * Label irisan komposisi: kode HS dan uraian singkat, nilai juta USD, dan persentase.
 * FIXED dipakai (bukan TEXT) karena mengikuti pemisah desimal lokal Excel.
 * AGGREGATE menjumlahkan irisan angka dan mengabaikan #N/A pada slot kosong.
 */
function sliceLabel(row: number, description: string): string {
  const first = row < 20 ? 10 : 20;
  const name = `IF(A${row}="Lainnya","Lainnya",A${row}&" — "&IFERROR(IF(LEN(${description})>${LABEL_CHARS},LEFT(${description},${LABEL_CHARS - 1})&"…",${description}),""))`;
  const figures = `IF(ISNUMBER(B${row}),CHAR(10)&FIXED(B${row},0)&" juta USD · "&FIXED(IF(AGGREGATE(9,6,$B$${first}:$B$${first + 8})=0,0,B${row}/AGGREGATE(9,6,$B$${first}:$B$${first + 8})*100),1)&"%","")`;
  return `IF(A${row}="","",${name}&${figures})`;
}

function writeComposition(
  sheet: ExcelJS.Worksheet,
  rows: ReturnType<typeof buildCompositionGrid>,
  annual: WorkbookInput["periods"],
): { last: number } {
  const headers = ["Negara", "Level", "Kode", "Uraian"];
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) headers.push(`EksporUSD ${annual[slot]?.label ?? slot + 1}`);
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) headers.push(`ImporUSD ${annual[slot]?.label ?? slot + 1}`);
  headers.push("EksporJuta", "ImporJuta", "AdaEkspor", "AdaImpor", "KunciEkspor", "KunciImpor");
  sheet.addRow(headers);
  const written = rows.length ? rows : [];
  if (!written.length) sheet.addRow(["", "", "", ""]);
  written.forEach((row) => {
    const values: Array<string | number | null> = [row.partner, row.level, row.code, row.description];
    for (let slot = 0; slot < YEAR_SLOTS; slot += 1) values.push(row.exportUsd[slot] ?? null);
    for (let slot = 0; slot < YEAR_SLOTS; slot += 1) values.push(row.importUsd[slot] ?? null);
    const added = sheet.addRow(values);
    const excelRow = added.number;
    added.getCell(3).numFmt = "@";
    added.getCell(21).value = { formula: selectedMillionFormula(excelRow, 5) };
    added.getCell(22).value = { formula: selectedMillionFormula(excelRow, 13) };
    added.getCell(23).value = { formula: selectedPresentFormula(excelRow, 5) };
    added.getCell(24).value = { formula: selectedPresentFormula(excelRow, 13) };
    added.getCell(25).value = { formula: `IF(OR(A${excelRow}="",W${excelRow}<>1,U${excelRow}=0),NA(),U${excelRow}-ROW()/1000000000000)` };
    added.getCell(26).value = { formula: `IF(OR(A${excelRow}="",X${excelRow}<>1,V${excelRow}=0),NA(),V${excelRow}-ROW()/1000000000000)` };
  });
  sheet.getColumn(3).numFmt = "@";
  return { last: Math.max(sheet.rowCount, 2) };
}

/** Jumlah USD tahun Ya, lalu bagi satu kali. Tahun tanpa observasi tidak dihitung sebagai nol pada bendera ketersediaan. */
function selectedMillionFormula(row: number, startColumn: number): string {
  const sums: string[] = [];
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) {
    const column = columnLetter(startColumn + slot);
    const pick = YEAR_FIRST_ROW + slot;
    sums.push(`IF('${SHEET.dashboard}'!$H$${pick}="Ya",N(${column}${row}),0)`);
  }
  return `IF(A${row}="","",(${sums.join("+")})/1000000)`;
}

function selectedPresentFormula(row: number, startColumn: number): string {
  const flags: string[] = [];
  for (let slot = 0; slot < YEAR_SLOTS; slot += 1) {
    const column = columnLetter(startColumn + slot);
    const pick = YEAR_FIRST_ROW + slot;
    flags.push(`IF(AND('${SHEET.dashboard}'!$H$${pick}="Ya",${column}${row}<>""),1,0)`);
  }
  return `IF(A${row}="","",IF((${flags.join("+")})>0,1,0))`;
}

function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Label kategori grafik pertumbuhan: kode HS dan uraian singkat. */
function growthLabel(row: number, key: string): string {
  const description = `INDEX('${SHEET.level}'!$C$2:$C$200000,MATCH(${key},'${SHEET.level}'!$A$2:$A$200000,0))`;
  return `IF(A${row}="","",A${row}&" — "&IFERROR(IF(LEN(${description})>${LABEL_CHARS},LEFT(${description},${LABEL_CHARS - 1})&"…",${description}),""))`;
}

function writeSummary(sheet: ExcelJS.Worksheet, input: WorkbookInput, names: Map<string, string>, labelOf: (code: string) => string) {
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = "Ringkasan TOTAL per negara dan periode. Jangan menjumlahkan kolom ini untuk membuat total dunia; agregat resmi ada pada baris World di dasbor. HS2/HS4/HS6 tidak dijumlahkan di sini.";
  sheet.getCell("A1").alignment = { wrapText: true };
  sheet.getCell("A1").font = { name: "Calibri", italic: true };
  sheet.getRow(1).height = 32;
  const header = sheet.addRow(["Kode mitra", "Nama negara", "Periode", "Ekspor (juta USD)", "Impor (juta USD)", "Neraca (juta USD)", "Kelengkapan", "Sumber diperbarui"]);
  styleHeader(header);
  const sourcePeriods = input.periods.filter((period) => period.kind !== "CUMULATIVE");
  const partners = input.partners.filter((partner) => !partner.aggregate);
  for (const partner of partners) {
    for (const period of sourcePeriods) {
      const found = input.totals.find((row) => row.partnerCode === partner.code && row.periodCode === period.code);
      const row = sheet.addRow([
        partner.code,
        names.get(partner.code) ?? partner.name,
        labelOf(period.code),
        null,
        null,
        null,
        found?.completeness ?? "MISSING",
        found?.sourceUpdatedAt ?? null,
      ]);
      const excelRow = row.number;
      row.getCell(1).numFmt = "@";
      row.getCell(9).value = found?.exportUsd == null ? null : Number(found.exportUsd);
      row.getCell(10).value = found?.importUsd == null ? null : Number(found.importUsd);
      row.getCell(4).value = { formula: `IF(I${excelRow}="","",I${excelRow}/1000000)` };
      row.getCell(5).value = { formula: `IF(J${excelRow}="","",J${excelRow}/1000000)` };
      row.getCell(6).value = { formula: `IF(OR(D${excelRow}="",E${excelRow}=""),"n.a.",D${excelRow}-E${excelRow})` };
      row.getCell(4).numFmt = '#,##0.000';
      row.getCell(5).numFmt = '#,##0.000';
      row.getCell(6).numFmt = '#,##0.000';
    }
  }
  sheet.getColumn(9).hidden = true;
  sheet.getColumn(10).hidden = true;
  const last = Math.max(sheet.rowCount, 3);
  sheet.autoFilter = { from: "A2", to: `H${last}` };
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 36;
  sheet.getColumn(3).width = 28;
  sheet.getColumn(4).width = 22;
  sheet.getColumn(5).width = 22;
  sheet.getColumn(6).width = 22;
  sheet.getColumn(7).width = 16;
  sheet.getColumn(8).width = 24;
  sheet.autoFilter;
}

function groupCommodities(rows: CommodityRow[]): Map<string, Map<string, CommodityRow[]>> {
  const grouped = new Map<string, Map<string, CommodityRow[]>>();
  for (const row of rows) {
    let periods = grouped.get(row.partnerCode);
    if (!periods) {
      periods = new Map();
      grouped.set(row.partnerCode, periods);
    }
    let list = periods.get(row.periodCode);
    if (!list) {
      list = [];
      periods.set(row.periodCode, list);
    }
    list.push(row);
  }
  return grouped;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function writeCountry(
  sheet: ExcelJS.Worksheet,
  partner: WorkbookPartner,
  input: WorkbookInput,
  sheetName: string,
  byPeriod: Map<string, CommodityRow[]> | undefined,
): Promise<number> {
  sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  sheet.getCell("A1").value = partner.name;
  sheet.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: WHITE } };
  sheet.getCell("A1").fill = solid(NAVY);
  sheet.mergeCells("A1:I1");
  info(sheet, 2, "Kode M49", partner.code);
  info(sheet, 3, "Sumber", input.sourceLabel);
  info(sheet, 4, "Klasifikasi", input.classification);
  info(sheet, 5, "Kelengkapan negara", countryCompleteness(input.totals, partner.code));
  info(sheet, 6, "Terakhir sinkron", input.lastSyncedAt ?? "Belum ada");
  sheet.getCell("B2").numFmt = "@";
  const header = sheet.getRow(8);
  ["Periode", "Level HS", "Kode HS", "Induk HS", "Uraian", "Ekspor (juta USD)", "Impor (juta USD)", "Neraca (juta USD)", "Status sumber"].forEach((value, index) => {
    header.getCell(index + 1).value = value;
  });
  styleHeader(header);
  const sourcePeriods = input.periods.filter((period) => period.kind !== "CUMULATIVE");
  const monthlyAddresses = new Map<string, { exportCell: string; importCell: string }>();
  const described = new Map<string, CommodityRow>();
  for (const list of byPeriod?.values() ?? []) {
    for (const row of list) if (!described.has(row.hsCode)) described.set(row.hsCode, row);
  }
  let written = 0;
  let sinceYield = 0;
  for (const period of sourcePeriods) {
    const banner = sheet.addRow([period.label, "BAGIAN", null, null, `Periode ${period.label}`, null, null, null, null]);
    banner.font = { bold: true };
    banner.fill = solid(GAP);
    banner.outlineLevel = 0;
    const subset = (byPeriod?.get(period.code) ?? []).filter((row) => input.includeDetail || row.level === 0 || row.hsCode === "TOTAL");
    const totals = subset.filter((row) => row.hsCode === "TOTAL" || row.level === 0);
    const tree = orderHierarchically(subset.filter((row) => row.level > 0));
    const ordered = totals.length ? [...totals, ...tree] : [{ partnerCode: partner.code, periodCode: period.code, hsCode: "TOTAL", level: 0, parentCode: null, description: "Total seluruh komoditas", exportUsd: null, importUsd: null, sourceStatus: "MISSING" }, ...tree];
    for (const item of ordered) {
      const row = sheet.addRow([period.label, item.level === 0 ? "TOTAL" : `HS${item.level}`, item.hsCode, item.parentCode, item.description, null, null, null, statusText(item.exportUsd, item.importUsd, item.sourceStatus)]);
      const excelRow = row.number;
      row.getCell(10).value = item.exportUsd == null ? null : Number(item.exportUsd);
      row.getCell(11).value = item.importUsd == null ? null : Number(item.importUsd);
      row.getCell(6).value = { formula: `IF(J${excelRow}="","",J${excelRow}/1000000)` };
      row.getCell(7).value = { formula: `IF(K${excelRow}="","",K${excelRow}/1000000)` };
      row.getCell(8).value = { formula: `IF(OR(F${excelRow}="",G${excelRow}=""),"n.a.",F${excelRow}-G${excelRow})` };
      row.getCell(3).numFmt = "@";
      row.getCell(4).numFmt = "@";
      row.getCell(6).numFmt = '#,##0.000';
      row.getCell(7).numFmt = '#,##0.000';
      row.getCell(8).numFmt = '#,##0.000';
      row.outlineLevel = outlineLevelFor(item.level);
      if (item.level === 0) row.font = { bold: true };
      if (period.kind === "MONTHLY") {
        monthlyAddresses.set(`${item.hsCode}|${period.code}`, { exportCell: `J${excelRow}`, importCell: `K${excelRow}` });
      }
      written += 1;
      sinceYield += 1;
      if (sinceYield >= 500) {
        sinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }
  if (input.cumulative) {
    const banner = sheet.addRow([input.cumulative.label, "BAGIAN", null, null, "Kumulatif dihitung dari bulan yang diminta. Nilai resmi dikosongkan bila ada bulan yang hilang.", null, null, null, null]);
    banner.font = { bold: true };
    banner.fill = solid("FFFFE8D6");
    const codes = [...new Set([...monthlyAddresses.keys()].map((key) => key.split("|")[0]).filter((code): code is string => Boolean(code)))];
    if (!codes.includes("TOTAL")) codes.unshift("TOTAL");
    const descriptions = described;
    for (const hsCode of codes) {
      const sample = descriptions.get(hsCode);
      const level = hsCode === "TOTAL" ? 0 : (sample?.level ?? hsCode.length);
      const exportRefs = input.cumulative.monthCodes.map((code) => monthlyAddresses.get(`${hsCode}|${code}`)?.exportCell).filter((cell): cell is string => Boolean(cell));
      const importRefs = input.cumulative.monthCodes.map((code) => monthlyAddresses.get(`${hsCode}|${code}`)?.importCell).filter((cell): cell is string => Boolean(cell));
      const required = input.cumulative.monthCodes.length;
      const row = sheet.addRow([input.cumulative.label, level === 0 ? "TOTAL" : `HS${level}`, hsCode, sample?.parentCode ?? null, sample?.description ?? hsCode, null, null, null, null]);
      const excelRow = row.number;
      row.getCell(10).value = gatedSum(exportRefs, required);
      row.getCell(11).value = gatedSum(importRefs, required);
      row.getCell(6).value = { formula: `IF(J${excelRow}="","",J${excelRow}/1000000)` };
      row.getCell(7).value = { formula: `IF(K${excelRow}="","",K${excelRow}/1000000)` };
      row.getCell(8).value = { formula: `IF(OR(F${excelRow}="",G${excelRow}=""),"n.a.",F${excelRow}-G${excelRow})` };
      row.getCell(9).value = {
        formula: `="Ekspor: "&IF(${countExpr(exportRefs)}=${required},"COMPLETE",IF(${countExpr(exportRefs)}=0,"MISSING","PARTIAL"))&" | Impor: "&IF(${countExpr(importRefs)}=${required},"COMPLETE",IF(${countExpr(importRefs)}=0,"MISSING","PARTIAL"))`,
      };
      row.getCell(12).value = {
        formula: `IF(OR(${countExpr(exportRefs)}<${required},${countExpr(importRefs)}<${required}),"Kumulatif parsial atau kosong. Bulan yang tidak ada tidak diisi nol.","")`,
      };
      row.getCell(3).numFmt = "@";
      row.getCell(4).numFmt = "@";
      row.outlineLevel = outlineLevelFor(level);
      written += 1;
    }
  }
  sheet.getColumn(10).hidden = true;
  sheet.getColumn(11).hidden = true;
  sheet.getColumn(12).hidden = true;
  const last = Math.max(sheet.rowCount, 8);
  sheet.autoFilter = { from: "A8", to: `I${last}` };
  sheet.views = [{ state: "frozen", ySplit: 8 }];
  [18, 12, 16, 14, 56, 20, 20, 20, 42].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.pageSetup.orientation = "landscape";
  sheet.headerFooter.oddFooter = `&L${sheetName}&R${input.sourceLabel}`;
  return written;
}

function writeCoverage(sheet: ExcelJS.Worksheet, input: WorkbookInput, partners: WorkbookPartner[], sheetNames: Record<string, string>) {
  sheet.getCell("A1").value = "Laporan kelengkapan";
  sheet.getCell("A1").font = { size: 16, bold: true, color: { argb: WHITE } };
  sheet.getCell("A1").fill = solid(NAVY);
  sheet.mergeCells("A1:F1");
  sheet.addRow([]);
  sheet.addRow(["Sumber", input.sourceLabel]);
  sheet.addRow(["Jenis data", input.sourceKind]);
  sheet.addRow(["Klasifikasi", input.classification]);
  sheet.addRow(["HS8", input.hs8Status]);
  sheet.addRow(["Cakupan TOTAL", input.coveragePercent]);
  sheet.addRow(["Peringatan", input.warnings.join(" | ")]);
  sheet.addRow([]);
  const header = sheet.addRow(["Kode", "Negara", "Lembar", "Periode lengkap", "Periode parsial", "Periode kosong"]);
  styleHeader(header);
  const sourcePeriods = input.periods.filter((period) => period.kind !== "CUMULATIVE");
  for (const partner of partners) {
    const rows = sourcePeriods.map((period) => input.totals.find((total) => total.partnerCode === partner.code && total.periodCode === period.code)?.completeness ?? "MISSING");
    sheet.addRow([
      partner.code,
      partner.name,
      sheetNames[partner.code] ?? "",
      rows.filter((status) => status === "COMPLETE").length,
      rows.filter((status) => status === "PARTIAL").length,
      rows.filter((status) => status === "MISSING" || status === "UNAVAILABLE" || status === "FAILED" || status === "UNVERIFIED").length,
    ]);
  }
  sheet.getColumn(1).numFmt = "@";
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 36;
  sheet.getColumn(3).width = 32;
  sheet.views = [{ state: "frozen", ySplit: 9 }];
}

function addNames(
  workbook: ExcelJS.Workbook,
  totals: { last: number },
  hs: { last: number },
  trendRows: number,
  cmdRows: number,
  comp: { last: number },
) {
  const add = (name: string, ref: string) => {
    workbook.definedNames.add(ref, name);
  };
  add("FilterCountry", `'${SHEET.dashboard}'!$B$5`);
  add("FilterPeriod", `'${SHEET.dashboard}'!$AA$6`);
  add("YearLabel", `'${SHEET.dashboard}'!$G$${YEAR_FIRST_ROW}:$G$${YEAR_FIRST_ROW + YEAR_SLOTS - 1}`);
  add("YearPick", `'${SHEET.dashboard}'!$H$${YEAR_FIRST_ROW}:$H$${YEAR_FIRST_ROW + YEAR_SLOTS - 1}`);
  add("YearExport", `'${SHEET.view}'!$C$40:$C$${39 + YEAR_SLOTS}`);
  add("YearImport", `'${SHEET.view}'!$D$40:$D$${39 + YEAR_SLOTS}`);
  add("LatestExport", `'${SHEET.view}'!$Z$2`);
  add("FilterCommodity", `'${SHEET.dashboard}'!$B$7`);
  add("FilterHsCode", `'${SHEET.dashboard}'!$B$8`);
  add("FilterHsLevel", `'${SHEET.dashboard}'!$B$9`);
  add("FilterPrevPeriod", `'${SHEET.view}'!$Z$1`);
  add("TotName", `${SHEET.totals}!$A$2:$A$${totals.last}`);
  add("TotPeriod", `${SHEET.totals}!$C$2:$C$${totals.last}`);
  add("TotExpStatus", `${SHEET.totals}!$G$2:$G$${totals.last}`);
  add("TotImpStatus", `${SHEET.totals}!$H$2:$H$${totals.last}`);
  add("TotExpMn", `${SHEET.totals}!$K$2:$K$${totals.last}`);
  add("TotImpMn", `${SHEET.totals}!$L$2:$L$${totals.last}`);
  add("HsName", `${SHEET.hs}!$A$2:$A$${hs.last}`);
  add("HsPeriod", `${SHEET.hs}!$C$2:$C$${hs.last}`);
  add("HsCode", `${SHEET.hs}!$D$2:$D$${hs.last}`);
  add("HsExpStatus", `${SHEET.hs}!$H$2:$H$${hs.last}`);
  add("HsImpStatus", `${SHEET.hs}!$I$2:$I$${hs.last}`);
  add("HsExpMn", `${SHEET.hs}!$K$2:$K$${hs.last}`);
  add("HsImpMn", `${SHEET.hs}!$L$2:$L$${hs.last}`);
  add("TrendLabel", `${SHEET.trends}!$B$2:$B$${trendRows + 1}`);
  add("TrendExport", `${SHEET.trends}!$C$2:$C$${trendRows + 1}`);
  add("TrendImport", `${SHEET.trends}!$D$2:$D$${trendRows + 1}`);
  add("TrendBalance", `${SHEET.trends}!$E$2:$E$${trendRows + 1}`);
  add("CompExportNames", `'${SHEET.view}'!$C$10:$C$18`);
  add("CompExportValues", `'${SHEET.view}'!$B$10:$B$18`);
  add("CompImportNames", `'${SHEET.view}'!$C$20:$C$28`);
  add("CompImportValues", `'${SHEET.view}'!$B$20:$B$28`);
  add("GrowthNames", `'${SHEET.view}'!$C$30:$C$34`);
  add("GrowthValues", `'${SHEET.view}'!$B$30:$B$34`);
  const compEnd = Math.max(comp.last, 2);
  add("CompPartner", `'${SHEET.comp}'!$A$2:$A$${compEnd}`);
  add("CompLevel", `'${SHEET.comp}'!$B$2:$B$${compEnd}`);
  add("CompCode", `'${SHEET.comp}'!$C$2:$C$${compEnd}`);
  add("CompDesc", `'${SHEET.comp}'!$D$2:$D$${compEnd}`);
  add("CompSelExp", `'${SHEET.comp}'!$U$2:$U$${compEnd}`);
  add("CompSelImp", `'${SHEET.comp}'!$V$2:$V$${compEnd}`);
  add("CompExpPresent", `'${SHEET.comp}'!$W$2:$W$${compEnd}`);
  add("CompImpPresent", `'${SHEET.comp}'!$X$2:$X$${compEnd}`);
  add("CompExpKey", `'${SHEET.comp}'!$Y$2:$Y$${compEnd}`);
  add("CompImpKey", `'${SHEET.comp}'!$Z$2:$Z$${compEnd}`);
  add("CompFirst", `'${SHEET.comp}'!$A$2`);
  void cmdRows;
}

/**
 * Excel menolak nama terdefinisi polos di <c:f> grafik, sehingga sumbu kategori jatuh ke 1, 2, 3
 * dan rentang data tidak terhubung. Ganti dengan alamat rentang langsung pada sheet.
 */
function resolveChartRefs(workbook: ExcelJS.Workbook, charts: ChartSpec[]): ChartSpec[] {
  const model = (workbook.definedNames as unknown as { model?: Array<{ name: string; ranges: string[] }> }).model ?? [];
  const refs = new Map(model.map((entry) => [entry.name, entry.ranges[0] ?? entry.name]));
  const resolve = (name: string) => refs.get(name) ?? name;
  return charts.map((chart) => ({
    ...chart,
    categories: resolve(chart.categories),
    series: chart.series.map((series) => ({ ...series, values: resolve(series.values) })),
  }));
}

function buildCharts(periods: WorkbookInput["periods"], input: WorkbookInput, levelRanks: ReturnType<typeof buildLevelBoard>): ChartSpec[] {
  const labels = periods.map((period) => period.label);
  const partner = input.partners.find((item) => item.code === "0") ?? input.partners.find((item) => !item.aggregate);
  const annual = input.periods.filter((period) => period.kind === "ANNUAL");
  const selected = annual.at(-1);
  const exports = periods.map((period) => cachedTotal(input, partner?.code, period.code, "export"));
  const imports = periods.map((period) => cachedTotal(input, partner?.code, period.code, "import"));
  const balances = exports.map((value, index) => (value == null || imports[index] == null ? null : Number((value - (imports[index] as number)).toFixed(6))));
  const partnerLabelText = partner ? partnerLabel(partner) : "";
  const periodLabel = selected?.label ?? "";
  const composition = (flow: "X" | "M" | "XL" | "ML") => {
    const prefix = `${partnerLabelText}|${periodLabel}|HS2|${flow}|`;
    return levelRanks.filter((row) => row.key.startsWith(prefix)).slice(0, flow.endsWith("L") ? 1 : 8);
  };
  const exportSlices = [...composition("X"), ...composition("XL")];
  const importSlices = [...composition("M"), ...composition("ML")];
  const growth = levelRanks.filter((row) => row.key.startsWith(`${partnerLabelText}|${periodLabel}|HS2|G|`)).slice(0, 5);
  const charts: ChartSpec[] = [
    {
      title: "Tren tahunan (juta USD)",
      kind: "line",
      anchor: { fromCol: 0, fromRow: 19, toCol: 5, toRow: 34 },
      valueTitle: "juta USD",
      categoryTitle: "Tahun",
      valueFormat: "#,##0",
      categories: "TrendLabel",
      categoryLabels: labels,
      series: [
        { name: "Ekspor", values: "TrendExport", points: exports },
        { name: "Impor", values: "TrendImport", points: imports },
      ],
    },
    {
      title: "Kinerja perdagangan tahunan (juta USD)",
      kind: "combo",
      anchor: { fromCol: 0, fromRow: 34, toCol: 5, toRow: 49 },
      valueTitle: "juta USD",
      categoryTitle: "Tahun",
      valueFormat: "#,##0",
      categories: "TrendLabel",
      categoryLabels: labels,
      series: [
        { name: "Ekspor", values: "TrendExport", points: exports, plot: "bar" },
        { name: "Impor", values: "TrendImport", points: imports, plot: "bar" },
        { name: "Neraca", values: "TrendBalance", points: balances, plot: "line" },
      ],
    },
    {
      title: "Komposisi ekspor (juta USD dan %)",
      kind: "pie",
      anchor: { fromCol: 0, fromRow: 49, toCol: 5, toRow: 67 },
      categories: "CompExportNames",
      categoryLabels: pad(sliceLabels(exportSlices, "export"), 9, ""),
      series: [{ name: "Ekspor", values: "CompExportValues", points: pad(exportSlices.map((row) => row.exportMn), 9, null) }],
    },
    {
      title: "Komposisi impor (juta USD dan %)",
      kind: "pie",
      anchor: { fromCol: 0, fromRow: 67, toCol: 5, toRow: 85 },
      categories: "CompImportNames",
      categoryLabels: pad(sliceLabels(importSlices, "import"), 9, ""),
      series: [{ name: "Impor", values: "CompImportValues", points: pad(importSlices.map((row) => row.importMn), 9, null) }],
    },
    {
      title: "Top 5 komoditas dengan kenaikan tertinggi YoY (%)",
      kind: "bar",
      anchor: { fromCol: 0, fromRow: 85, toCol: 5, toRow: 99 },
      valueTitle: "Pertumbuhan ekspor (%)",
      categoryTitle: "Komoditas (kode HS)",
      valueFormat: '0"%"',
      categories: "GrowthNames",
      categoryLabels: pad(growth.map(chartLabel), 5, ""),
      series: [{ name: "Pertumbuhan ekspor (%)", values: "GrowthValues", points: pad(growth.map((row) => row.growthPct), 5, null) }],
    },
  ];
  return input.includeCharts ? charts : [];
}

function sliceLabels(rows: ReturnType<typeof buildLevelBoard>, flow: "export" | "import"): string[] {
  const values = rows.map((row) => (flow === "export" ? row.exportMn : row.importMn) ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
  const share = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return rows.map((row, index) => `${chartLabel(row)}\n${number.format(values[index] ?? 0)} juta USD · ${share.format(total ? ((values[index] ?? 0) / total) * 100 : 0)}%`);
}

function chartLabel(row: { code: string; description: string }): string {
  if (row.code === "Lainnya") return "Lainnya";
  const text = row.description.length > LABEL_CHARS ? `${row.description.slice(0, LABEL_CHARS - 1)}…` : row.description;
  return `${row.code} — ${text}`;
}

function annualChartPeriods(input: WorkbookInput): WorkbookInput["periods"] {
  const byCode = new Map<string, WorkbookInput["periods"][number]>();
  for (const period of [...input.periods, ...(input.chartPeriods ?? [])]) {
    if (period.kind === "ANNUAL") byCode.set(period.code, period);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function boardPeriods(input: WorkbookInput): WorkbookInput["periods"] {
  const annual = annualChartPeriods(input);
  const rest = input.periods.filter((period) => period.kind !== "ANNUAL" && !annual.some((item) => item.code === period.code));
  return [...annual, ...rest];
}

function cachedTotal(input: WorkbookInput, partnerCode: string | undefined, periodCode: string, flow: "export" | "import"): number | null {
  if (!partnerCode) return null;
  const row = [...input.totals, ...(input.chartTotals ?? [])].find((item) => item.partnerCode === partnerCode && item.periodCode === periodCode);
  if (!row) return null;
  return toMillionNumber(flow === "export" ? row.exportUsd : row.importUsd);
}

function pad<T>(values: T[], length: number, fill: T): T[] {
  return Array.from({ length }, (_, index) => values[index] ?? fill);
}

function countryCompleteness(totals: MoneyRow[], partnerCode: string): string {
  const rows = totals.filter((row) => row.partnerCode === partnerCode);
  if (!rows.length) return "MISSING";
  if (rows.every((row) => row.completeness === "COMPLETE")) return "COMPLETE";
  if (rows.every((row) => row.completeness === "MISSING")) return "MISSING";
  return "PARTIAL";
}

function gatedSum(refs: string[], required: number): ExcelJS.CellFormulaValue {
  if (!refs.length) return { formula: '""' };
  return { formula: `IF(COUNT(${refs.join(",")})=${required},SUM(${refs.join(",")}),"")` };
}

function countExpr(refs: string[]): string {
  if (!refs.length) return "0";
  return `COUNT(${refs.join(",")})`;
}

function validation(cell: ExcelJS.Cell, formula: string) {
  cell.dataValidation = {
    type: "list",
    allowBlank: false,
    formulae: [formula],
    showErrorMessage: true,
    errorStyle: "stop",
    errorTitle: "Pilihan tidak valid",
    error: "Gunakan daftar pada sel ini.",
    showInputMessage: true,
    promptTitle: "Filter",
    prompt: "Pilih nilai dari daftar. KPI dan grafik mengikuti pilihan ini.",
  };
}

function label(sheet: ExcelJS.Worksheet, address: string, text: string) {
  sheet.getCell(address).value = text;
  sheet.getCell(address).font = { name: "Calibri", bold: true, color: { argb: MUTED } };
}

function kpiCard(sheet: ExcelJS.Worksheet, row: number, title: string | ExcelJS.CellFormulaValue, formula: string, numFmt: string, accent: string) {
  sheet.mergeCells(`D${row}:E${row}`);
  sheet.mergeCells(`D${row + 1}:E${row + 1}`);
  const head = sheet.getCell(`D${row}`);
  head.value = title;
  head.font = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
  head.fill = solid(accent);
  head.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  const value = sheet.getCell(`D${row + 1}`);
  value.value = { formula };
  value.numFmt = numFmt;
  value.font = { name: "Calibri", size: 18, bold: true, color: { argb: INK } };
  value.fill = solid(PAPER);
  value.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
  const edge: ExcelJS.Border = { style: "medium", color: { argb: accent } };
  for (const address of [`D${row}`, `E${row}`, `D${row + 1}`, `E${row + 1}`]) {
    sheet.getCell(address).border = { top: edge, left: edge, bottom: edge, right: edge };
  }
  sheet.getRow(row + 1).height = 30;
}

function meta(sheet: ExcelJS.Worksheet, address: string, name: string, value: string) {
  sheet.getCell(address).value = name;
  sheet.getCell(address).font = { name: "Calibri", color: { argb: MUTED } };
  const target = address.replace("A", "B");
  sheet.getCell(target).value = value;
  sheet.getCell(target).font = { name: "Calibri" };
}

function section(sheet: ExcelJS.Worksheet, address: string, text: string) {
  sheet.getCell(address).value = text;
  sheet.getCell(address).font = { name: "Calibri", bold: true, color: { argb: NAVY } };
}

function info(sheet: ExcelJS.Worksheet, row: number, name: string, value: string) {
  sheet.getCell(`A${row}`).value = name;
  sheet.getCell(`A${row}`).font = { name: "Calibri", color: { argb: MUTED } };
  sheet.getCell(`B${row}`).value = value;
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE } };
    cell.fill = solid(NAVY);
    cell.alignment = { vertical: "middle" };
  });
  row.height = 20;
}

function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function border(): Partial<ExcelJS.Borders> {
  const edge: ExcelJS.Border = { style: "thin", color: { argb: "FFE2D9CC" } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}
