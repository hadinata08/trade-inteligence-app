import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { EXCEL_MAX_ROWS, EXCEL_MAX_SHEET_NAME, toMillionUsd } from "@iti/shared";
import { planVolumes } from "./model";
import { SHEET } from "./model";
import { writeTradeWorkbook } from "./workbook";
import type { CommodityRow, MoneyRow, WorkbookInput } from "./model";

const dir = await mkdtemp(path.join(tmpdir(), "iti-xlsx-"));
const file = path.join(dir, "INDONESIA_TRADE_INTELLIGENCE.xlsx");

const months = ["202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608"];

function commodity(partial: Partial<CommodityRow> & Pick<CommodityRow, "partnerCode" | "periodCode" | "hsCode" | "level">): CommodityRow {
  return {
    parentCode: partial.parentCode ?? null,
    description: partial.description ?? partial.hsCode,
    exportUsd: partial.exportUsd ?? null,
    importUsd: partial.importUsd ?? null,
    sourceStatus: partial.sourceStatus ?? "REPORTED",
    ...partial,
  };
}

function total(partial: Partial<MoneyRow> & Pick<MoneyRow, "partnerCode" | "periodCode">): MoneyRow {
  return {
    exportUsd: partial.exportUsd ?? null,
    importUsd: partial.importUsd ?? null,
    completeness: partial.completeness ?? (partial.exportUsd != null && partial.importUsd != null ? "COMPLETE" : partial.exportUsd || partial.importUsd ? "PARTIAL" : "MISSING"),
    sourceUpdatedAt: partial.sourceUpdatedAt ?? "2026-10-01T00:00:00.000Z",
    ...partial,
  };
}

const chinaTree: Array<Omit<CommodityRow, "partnerCode" | "periodCode" | "exportUsd" | "importUsd">> = [
  { hsCode: "TOTAL", level: 0, parentCode: null, description: "Total", sourceStatus: "REPORTED" },
  { hsCode: "15", level: 2, parentCode: null, description: "Lemak dan minyak", sourceStatus: "REPORTED" },
  { hsCode: "1513", level: 4, parentCode: "15", description: "Minyak kelapa", sourceStatus: "REPORTED" },
  { hsCode: "1511", level: 4, parentCode: "15", description: "Minyak sawit", sourceStatus: "REPORTED" },
  { hsCode: "151110", level: 6, parentCode: "1511", description: "Sawit mentah", sourceStatus: "REPORTED" },
  { hsCode: "151190", level: 6, parentCode: "1511", description: "Sawit lainnya", sourceStatus: "REPORTED" },
  { hsCode: "15119010", level: 8, parentCode: "151190", description: "Fraksi sawit", sourceStatus: "REPORTED" },
  { hsCode: "09", level: 2, parentCode: null, description: "Kopi, teh, dan rempah", sourceStatus: "REPORTED" },
  { hsCode: "0901", level: 4, parentCode: "09", description: "Kopi", sourceStatus: "REPORTED" },
  { hsCode: "090111", level: 6, parentCode: "0901", description: "Kopi tidak disangrai", sourceStatus: "REPORTED" },
];

function expand(partnerCode: string, periodCode: string, exportUsd: string | null, importUsd: string | null): CommodityRow[] {
  return chinaTree.map((row) =>
    commodity({
      ...row,
      partnerCode,
      periodCode,
      exportUsd: exportUsd == null ? null : scale(exportUsd, row.hsCode),
      importUsd: importUsd == null ? null : scale(importUsd, row.hsCode),
    }),
  );
}

function scale(totalUsd: string, hsCode: string): string {
  if (hsCode === "TOTAL") return totalUsd;
  const share: Record<string, string> = {
    "15": "0.2",
    "1513": "0.04",
    "1511": "0.1",
    "151110": "0.05",
    "151190": "0.03",
    "15119010": "0.01",
    "09": "0.05",
    "0901": "0.03",
    "090111": "0.02",
  };
  return (Number(totalUsd) * Number(share[hsCode] ?? "0")).toFixed(2);
}

const input: WorkbookInput = {
  generatedAt: "2026-10-17T00:00:00.000Z",
  sourceLabel: "DATA CONTOH — bukan UN Comtrade",
  sourceKind: "FIXTURE",
  classification: "HS / H6",
  lastSyncedAt: "2026-10-17T00:00:00.000Z",
  coveragePercent: 66.7,
  warnings: ["DATA CONTOH. Jangan dipakai sebagai statistik resmi."],
  hs8Status: "PARTIAL",
  partners: [
    { code: "0", name: "World", aggregate: true },
    { code: "156", name: "China", aggregate: false },
    { code: "392", name: "Japan", aggregate: false },
    { code: "842", name: "United States of America", aggregate: false },
  ],
  periods: [
    { code: "2024", label: "2024", kind: "ANNUAL" },
    { code: "2025", label: "2025", kind: "ANNUAL" },
    ...months.map((code) => ({ code, label: `${code.slice(0, 4)}-${code.slice(4)}`, kind: "MONTHLY" as const })),
    { code: "2026M01-08", label: "2026 Jan–Agt (kumulatif)", kind: "CUMULATIVE" },
  ],
  totals: [
    total({ partnerCode: "0", periodCode: "2024", exportUsd: "3000000.00", importUsd: "4000000.00" }),
    total({ partnerCode: "0", periodCode: "2025", exportUsd: "3300000.00", importUsd: "4100000.00" }),
    total({ partnerCode: "156", periodCode: "2024", exportUsd: "1000000.00", importUsd: "2500000.00" }),
    total({ partnerCode: "156", periodCode: "2025", exportUsd: "1100000.00", importUsd: "2600000.00" }),
    total({ partnerCode: "392", periodCode: "2024", exportUsd: "500000.00", importUsd: null, completeness: "PARTIAL" }),
    total({ partnerCode: "392", periodCode: "2025", exportUsd: "550000.00", importUsd: "100000.00" }),
    total({ partnerCode: "842", periodCode: "2024", exportUsd: "800000.00", importUsd: "200000.00" }),
    total({ partnerCode: "842", periodCode: "2025", exportUsd: "900000.00", importUsd: "250000.00" }),
    ...months.map((code) =>
      total({
        partnerCode: "156",
        periodCode: code,
        exportUsd: code === "202602" ? null : "100000.00",
        importUsd: code === "202602" ? null : "200000.00",
        completeness: code === "202602" ? "MISSING" : "COMPLETE",
      }),
    ),
  ],
  commodities: [
    ...expand("156", "2024", "1000000.00", "2500000.00"),
    ...expand("156", "2025", "1100000.00", "2600000.00"),
    ...months.flatMap((code) => expand("156", code, code === "202602" ? null : "100000.00", code === "202602" ? null : "200000.00")),
    commodity({ partnerCode: "392", periodCode: "2024", hsCode: "TOTAL", level: 0, description: "Total", exportUsd: "500000.00", importUsd: null, sourceStatus: "REPORTED" }),
    commodity({ partnerCode: "842", periodCode: "2024", hsCode: "TOTAL", level: 0, description: "Total", exportUsd: "800000.00", importUsd: "200000.00", sourceStatus: "REPORTED" }),
  ],
  helperCommodities: expand("156", "2024", "1000000.00", "2500000.00").filter((row) => row.level === 2),
  cumulative: { label: "2026 Jan–Agt (kumulatif)", monthCodes: months },
  includeCharts: true,
  includeDetail: true,
  includeCoverage: true,
};

let writtenSheets: string[] = [];

describe("excel workbook", () => {
  it("writes a workbook that ExcelJS can reopen", async () => {
    const written = await writeTradeWorkbook(file, input);
    writtenSheets = written.sheets;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    expect(workbook.worksheets[0]?.name).toBe(SHEET.dashboard);
    expect(workbook.worksheets[1]?.name).toBe(SHEET.summary);
    expect(written.sheets).toContain("3 China");
    expect(written.sheets).toContain("4 Japan");
    expect(written.sheets.some((name) => name.startsWith("5 ") && name.includes("United States"))).toBe(true);
    expect(written.charts).toBe(5);
    for (const name of written.sheets) expect(name.length).toBeLessThanOrEqual(EXCEL_MAX_SHEET_NAME);
  });

  it("keeps the HS hierarchy, leading zeros, and does not turn missing imports into zero", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const china = workbook.getWorksheet("3 China");
    expect(china).toBeTruthy();
    const codes: string[] = [];
    const levels = new Map<string, number>();
    china?.eachRow((row) => {
      const code = row.getCell(3).value;
      if (typeof code === "string" && (code === "TOTAL" || /^\d+$/.test(code))) {
        codes.push(code);
        levels.set(code, row.outlineLevel ?? 0);
        expect(row.getCell(3).numFmt).toBe("@");
      }
    });
    expect(codes).toContain("090111");
    expect(codes.indexOf("15")).toBeLessThan(codes.indexOf("1511"));
    expect(codes.indexOf("151110")).toBeLessThan(codes.indexOf("1513"));
    expect(codes.indexOf("151190")).toBeLessThan(codes.indexOf("15119010"));
    expect(levels.get("090111") ?? 0).toBeGreaterThan(levels.get("0901") ?? 0);
    expect(levels.get("15119010") ?? 0).toBeGreaterThan(levels.get("151190") ?? 0);
    expect(codes.filter((code) => code === "2024").length === 0).toBe(true);

    const summary = workbook.getWorksheet(SHEET.summary);
    let japanImport: ExcelJS.CellValue = 0;
    summary?.eachRow((row) => {
      if (row.getCell(1).value === "392" && row.getCell(3).value === "2024") {
        japanImport = row.getCell(10).value;
        expect(row.getCell(5).value).toMatchObject({ formula: expect.stringContaining("/1000000") });
        const balance = row.getCell(6).value as { formula?: string };
        expect(balance.formula).toContain("n.a.");
        expect(balance.formula).toContain("-");
      }
    });
    expect(japanImport == null || japanImport === "").toBe(true);

    const cumulative = china?.getColumn(1);
    void cumulative;
    let cumulativeFormula = "";
    china?.eachRow((row) => {
      if (row.getCell(1).value === "2026 Jan–Agt (kumulatif)" && row.getCell(3).value === "TOTAL") {
        cumulativeFormula = String((row.getCell(10).value as { formula?: string })?.formula ?? "");
      }
    });
    expect(cumulativeFormula).toContain("COUNT(");
    expect(cumulativeFormula).toContain("=8");
    expect(cumulativeFormula).not.toContain(",0)");
    expect(china?.rowCount ?? 0).toBeLessThan(EXCEL_MAX_ROWS);
  });

  it("stores dashboard validations, live formulas, and native charts", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const dashboard = workbook.getWorksheet(SHEET.dashboard);
    expect(dashboard?.getCell("B5").dataValidation?.type).toBe("list");
    expect(dashboard?.getCell("H6").dataValidation?.type).toBe("list");
    expect(dashboard?.getCell("H7").dataValidation?.type).toBe("list");
    expect(String(dashboard?.getCell("H6").dataValidation?.formulae?.[0] ?? "")).toContain("Ya");
    expect(dashboard?.getCell("G6").value).toBe("2024");
    expect(dashboard?.getCell("H6").value).toBe("Tidak");
    expect(dashboard?.getCell("G7").value).toBe("2025");
    expect(dashboard?.getCell("H7").value).toBe("Ya");
    const activeYears = String((dashboard?.getCell("B6").value as { formula?: string })?.formula ?? "");
    expect(activeYears).toContain('H6="Ya"');
    expect(activeYears).toContain('G6&", "');
    expect(activeYears).toContain("LEFT(");
    expect(activeYears).not.toContain("TEXTJOIN");
    expect(String((dashboard?.getCell("AA6").value as { formula?: string })?.formula ?? "")).toContain('H7="Ya"');
    expect(dashboard?.getCell("B7").dataValidation?.type).toBe("list");
    expect(dashboard?.getCell("B9").dataValidation?.type).toBe("list");
    expect(dashboard?.getCell("B9").value).toBe("HS2");
    const exportFormula = String((dashboard?.getCell("D6").value as { formula?: string })?.formula ?? "");
    const balanceFormula = String((dashboard?.getCell("D10").value as { formula?: string })?.formula ?? "");
    expect(exportFormula).toContain("YearPick");
    expect(exportFormula).toContain("YearExport");
    expect(exportFormula).toContain("n.a.");
    expect(balanceFormula).toBe('IF(OR(D6="n.a.",D8="n.a.",D6="",D8=""),"n.a.",D6-D8)');
    expect(dashboard?.getCell("D5").value).toBe("Total ekspor (juta USD)");
    expect(dashboard?.getCell("D11").value).toContain("Pertumbuhan ekspor (%)");
    const growthFormula = String((dashboard?.getCell("D12").value as { formula?: string })?.formula ?? "");
    expect(growthFormula).toContain("FilterPrevPeriod");
    expect(growthFormula).toContain("LatestExport");
    expect(growthFormula).toContain("n.a.");
    const levelLine = String((dashboard?.getCell("B103").value as { formula?: string })?.formula ?? "");
    expect(levelLine).toContain("_VIEW");
    expect(String(dashboard?.getCell("A18").value ?? "")).toContain("pie komposisi");
    const view = workbook.getWorksheet(SHEET.view);
    const rankFormula = String((view?.getCell("E50").value as { formula?: string })?.formula ?? "");
    expect(rankFormula).toContain("AGGREGATE");
    expect(rankFormula).toContain("FilterHsLevel");
    expect(rankFormula).toContain("CompExpKey");
    expect(rankFormula).not.toContain("FilterPeriod");
    const comp = workbook.getWorksheet(SHEET.comp);
    let chinaHs15: ExcelJS.Row | undefined;
    let coffeeCode = "";
    comp?.eachRow((row) => {
      if (row.getCell(1).value === "China" && row.getCell(2).value === "HS2" && String(row.getCell(3).value) === "15") chinaHs15 = row;
      if (row.getCell(1).value === "China" && row.getCell(2).value === "HS2" && String(row.getCell(3).value) === "09") coffeeCode = String(row.getCell(3).value);
    });
    expect(chinaHs15?.getCell(5).value).toBe(200000);
    expect(chinaHs15?.getCell(6).value).toBe(220000);
    const sumFormula = String((chinaHs15?.getCell(21).value as { formula?: string })?.formula ?? "");
    expect(sumFormula).toContain('$H$6="Ya"');
    expect(sumFormula).toContain('$H$7="Ya"');
    expect(sumFormula).toContain("/1000000");
    expect(sumFormula).not.toContain("TEXTJOIN");
    expect(coffeeCode).toBe("09");
    expect(dashboard?.getCell("A16").value).toContain("DATA CONTOH");

    const totals = workbook.getWorksheet(SHEET.totals);
    let chinaExport: number | null = null;
    totals?.eachRow((row) => {
      if (row.getCell(2).value === "156" && row.getCell(4).value === "2024") chinaExport = Number(row.getCell(5).value);
    });
    expect(chinaExport).toBe(1000000);
    expect(Number(toMillionUsd("1000000.00").toFixed(6))).toBe(1);

    const zip = await JSZip.loadAsync(await readFile(file));
    const chart1 = await zip.file("xl/charts/chart1.xml")?.async("string");
    const chart2 = await zip.file("xl/charts/chart2.xml")?.async("string");
    const drawing = await zip.file("xl/drawings/drawing1.xml")?.async("string");
    expect(chart1).toContain("<c:lineChart>");
    // Grafik memakai alamat rentang langsung, bukan nama terdefinisi polos yang ditolak Excel.
    expect(chart1).toContain("<c:f>'_TRENDS'!$C$2:$C$3</c:f>");
    expect(chart1).not.toContain("<c:f>TrendExport</c:f>");
    expect(chart1).toContain("juta USD");
    expect(chart1).toContain("<c:pt idx=\"0\"><c:v>3</c:v></c:pt>");
    expect(chart1).toContain('dispBlanksAs val="gap"');
    expect(chart2).toContain("<c:barChart>");
    expect(chart2).toContain("<c:lineChart>");
    // Kinerja tahunan memakai rentang tahun yang sama dengan Tren tahunan.
    expect(chart2).toContain("<c:f>'_TRENDS'!$E$2:$E$3</c:f>");
    expect(chart1).toMatch(/<c:smooth val="0"\/>\s*<\/c:ser>/);
    expect(chart1).toContain('formatCode="#,##0"');
    const chart3 = await zip.file("xl/charts/chart3.xml")?.async("string");
    const chart5 = await zip.file("xl/charts/chart5.xml")?.async("string");
    expect(chart3).toContain("<c:pieChart>");
    expect(chart3).toContain("juta USD · ");
    expect(chart5).toContain('<c:barDir val="bar"/>');
    expect(drawing).toContain("http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing");
    expect(drawing).toContain("c:chart");
    expect(chart3).toContain('<c:showCatName val="1"/>');
    expect(chart3).toContain('<c:dLblPos val="bestFit"/>');
    expect(chart3).toContain("<c:f>'_VIEW'!$C$10:$C$18</c:f>");
    expect(chart5).toContain('<c:invertIfNegative val="0"/>');
    // Grafik "Perbandingan negara" dihapus.
    expect(zip.file("xl/charts/chart6.xml")).toBeFalsy();
    // Tabel 10 tujuan ekspor dan 10 asal impor dihapus; tabel komoditas tetap punya header.
    expect(dashboard?.getCell("B102").value).toBe("Kode HS");
    expect(workbook.getWorksheet("_RANK_EXP")).toBeUndefined();
    expect(dashboard?.getCell("D102").value).toBe("Ekspor (juta USD)");
    const cmdValue = String((dashboard?.getCell("D103").value as { formula?: string })?.formula ?? "");
    expect(cmdValue).toContain("n.a.");
    expect(chart5).toContain("Top 5 komoditas dengan kenaikan tertinggi YoY (%)");
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbookXml?.indexOf("01 DASHBOARD")).toBeLessThan(workbookXml?.indexOf("02 SUMMARY ALL COUNTRIES") ?? 0);
    expect(workbookXml).toContain("FilterCountry");
    expect(workbookXml).toContain("FilterHsLevel");
  });
});

describe("workbook planning", () => {
  it("keeps a small extract in one workbook and splits an impractical extract", () => {
    const small = planVolumes([
      { code: "156", rows: 100 },
      { code: "392", rows: 80 },
    ]);
    expect(small.singleWorkbook).toBe(true);
    expect(small.files[0]?.partnerCodes).toEqual(["156", "392"]);
    const large = planVolumes([
      { code: "156", rows: 150_000 },
      { code: "392", rows: 150_000 },
    ]);
    expect(large.singleWorkbook).toBe(false);
    expect(large.files).toHaveLength(2);
    const overflow = planVolumes([{ code: "156", rows: EXCEL_MAX_ROWS + 10 }]);
    expect(overflow.overflowPartners.map((partner) => partner.code)).toEqual(["156"]);
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
