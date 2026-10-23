import { describe, expect, it } from "vitest";
import {
  compareTotalWithLevel,
  cumulativeMonths,
  growthRate,
  millionUsdString,
  sumTradeAtLevel,
  toMillionUsd,
  tradeBalance,
} from "./calculations";
import { CUMULATIVE_2026 } from "./constants";
import { inferParentCode, orderHierarchically, outlineLevelFor } from "./hs";
import { naturalObservationKey, stableId } from "./ids";
import { fullReportFilters, LoginSchema } from "./schemas";

describe("trade calculations", () => {
  it("computes balance as exports minus imports and keeps a negative result", () => {
    expect(tradeBalance("10.00", "4.50")).toBe("5.50");
    expect(tradeBalance("4.00", "9.00")).toBe("-5.00");
    expect(tradeBalance(null, "1.00")).toBeNull();
    expect(tradeBalance("0.00", "0.00")).toBe("0.00");
  });

  it("converts USD to millions without rounding the source amount first", () => {
    expect(toMillionUsd("1").toFixed(12)).toBe("0.000001000000");
    expect(millionUsdString("1234567.89")).toBe("1.234568");
    const aggregated = toMillionUsd("1000000.4").plus(toMillionUsd("1000000.4"));
    expect(aggregated.toFixed(7)).toBe("2.0000008");
  });

  it("does not invent a growth rate when the base is zero or missing", () => {
    expect(growthRate("110", "100")).toBe("10.0000");
    expect(growthRate("50", "0")).toBeNull();
    expect(growthRate(null, "10")).toBeNull();
  });

  it("marks an incomplete January–August cumulative as partial and does not zero-fill", () => {
    const result = cumulativeMonths(
      [
        { month: 1, exportUsd: "10.00", importUsd: "4.00", verified: true },
        { month: 2, exportUsd: null, importUsd: null, verified: false },
      ],
      CUMULATIVE_2026.months,
    );
    expect(result.status).toBe("PARTIAL");
    expect(result.exportUsd).toBeNull();
    expect(result.importUsd).toBeNull();
    expect(result.disclosedPartialExportUsd).toBe("10.00");
    expect(result.monthsMissing).toContain(2);
    expect(result.monthsMissing).toContain(8);
  });

  it("sums a complete eight-month window and returns missing when nothing is verified", () => {
    const points = CUMULATIVE_2026.months.map((month) => ({
      month,
      exportUsd: "2.00",
      importUsd: "1.50",
      verified: true,
    }));
    const complete = cumulativeMonths(points, CUMULATIVE_2026.months);
    expect(complete.status).toBe("COMPLETE");
    expect(complete.exportUsd).toBe("16.00");
    expect(complete.importUsd).toBe("12.00");
    expect(tradeBalance(complete.exportUsd, complete.importUsd)).toBe("4.00");

    const missing = cumulativeMonths([], CUMULATIVE_2026.months);
    expect(missing.status).toBe("MISSING");
    expect(missing.exportUsd).toBeNull();
    expect(missing.disclosedPartialExportUsd).toBeNull();
  });

  it("never adds HS2, HS4, and HS6 into one total", () => {
    const rows = [
      { level: 2, valueUsd: "10.00" },
      { level: 4, valueUsd: "6.00" },
      { level: 4, valueUsd: "4.00" },
      { level: 6, valueUsd: "1.00" },
    ];
    expect(sumTradeAtLevel(rows, 2).sumUsd).toBe("10.00");
    expect(sumTradeAtLevel(rows, 4).sumUsd).toBe("10.00");
    expect(sumTradeAtLevel(rows, 6).sumUsd).toBe("1.00");
    const mixed = rows.reduce((sum, row) => sum + Number(row.valueUsd), 0);
    expect(mixed).not.toBe(Number(sumTradeAtLevel(rows, 2).sumUsd));
  });

  it("returns a null level sum when any observation at that level is missing", () => {
    const result = sumTradeAtLevel(
      [
        { level: 2, valueUsd: "5.00" },
        { level: 2, valueUsd: null },
      ],
      2,
    );
    expect(result.sumUsd).toBeNull();
    expect(result.missing).toBe(1);
    expect(result.included).toBe(1);
  });

  it("compares TOTAL with an HS aggregate without forcing them to match", () => {
    const gap = compareTotalWithLevel("100.00", "97.50");
    expect(gap.comparable).toBe(true);
    expect(gap.differenceUsd).toBe("2.50");
    expect(compareTotalWithLevel(null, "10").comparable).toBe(false);
  });
});

describe("HS hierarchy", () => {
  it("walks parents before descendants and before the next sibling", () => {
    const ordered = orderHierarchically([
      { hsCode: "1513", level: 4, parentCode: "15" },
      { hsCode: "151110", level: 6, parentCode: "1511" },
      { hsCode: "84", level: 2, parentCode: null },
      { hsCode: "1511", level: 4, parentCode: "15" },
      { hsCode: "15", level: 2, parentCode: null },
      { hsCode: "151190", level: 6, parentCode: "1511" },
      { hsCode: "15119010", level: 8, parentCode: "151190" },
      { hsCode: "090111", level: 6, parentCode: "0901" },
      { hsCode: "09", level: 2, parentCode: null },
      { hsCode: "0901", level: 4, parentCode: "09" },
    ]);
    const codes = ordered.map((row) => row.hsCode);
    expect(codes.indexOf("09")).toBeLessThan(codes.indexOf("0901"));
    expect(codes.indexOf("0901")).toBeLessThan(codes.indexOf("090111"));
    expect(codes.indexOf("090111")).toBeLessThan(codes.indexOf("15"));
    expect(codes.indexOf("151110")).toBeLessThan(codes.indexOf("1513"));
    expect(codes.indexOf("151190")).toBeLessThan(codes.indexOf("15119010"));
    expect(codes.indexOf("15119010")).toBeLessThan(codes.indexOf("1513"));
    expect(outlineLevelFor(8)).toBeGreaterThan(outlineLevelFor(6));
    expect(outlineLevelFor(6)).toBeGreaterThan(outlineLevelFor(2));
  });

  it("preserves leading zeros when inferring parents", () => {
    expect(inferParentCode("090111")).toBe("0901");
    expect(inferParentCode("09")).toBeNull();
    expect(inferParentCode("TOTAL")).toBeNull();
  });
});

describe("identifiers", () => {
  it("is stable for the same partition payload", () => {
    expect(stableId("part", { b: 1, a: 2 })).toBe(stableId("part", { a: 2, b: 1 }));
    expect(stableId("part", { a: 1 }).includes(":")).toBe(false);
  });

  it("keeps HS codes as text inside the natural key", () => {
    const key = naturalObservationKey({
      reporterCode: "360",
      partnerCode: "156",
      secondPartnerCode: "0",
      periodCode: "2024",
      flow: "EXPORT",
      hsCode: "090111",
      customsCode: "C00",
      transportMode: "0",
    });
    expect(key).toContain("090111");
  });
});

describe("full report preset", () => {
  it("requests every source period, cumulative 2026, and HS8", () => {
    const filters = fullReportFilters();
    expect(filters.preset).toBe("full");
    expect(filters.allPartners).toBe(true);
    expect(filters.periods).toContain("2020");
    expect(filters.periods).toContain("2025");
    expect(filters.periods).toContain("202601");
    expect(filters.periods).toContain("202608");
    expect(filters.periods).toContain(CUMULATIVE_2026.code);
    expect(filters.hsLevels).toEqual([0, 2, 4, 6, 8]);
    expect(filters.includeCharts).toBe(true);
    expect(filters.includeDetail).toBe(true);
  });
});

describe("login schema", () => {
  it("accepts the documented localhost admin address", () => {
    expect(LoginSchema.safeParse({ email: "admin@localhost", password: "dev-admin-password" }).success).toBe(true);
    expect(LoginSchema.safeParse({ email: "not-an-email", password: "dev-admin-password" }).success).toBe(false);
  });
});
