import { describe, expect, it } from "vitest";
import { compositionSlices, parseHsLevel, parsePeriods, rankGrowth, sumPeriods, togglePeriod, topCommodities } from "./dashboard-view";

describe("dashboard slicer views", () => {
  it("accepts only HS2, HS4, and HS6", () => {
    expect(parseHsLevel("6")).toBe(6);
    expect(parseHsLevel("4")).toBe(4);
    expect(parseHsLevel("8")).toBe(2);
    expect(parseHsLevel(undefined)).toBe(2);
  });

  it("reads several periods from the URL and falls back to the latest year", () => {
    const available = ["2020", "2021", "2022", "2023", "2024", "2025", "202601"];
    expect(parsePeriods("2025,2023,abc", available, "2025")).toEqual(["2023", "2025"]);
    expect(parsePeriods(["2021", "2021"], available, "2025")).toEqual(["2021"]);
    expect(parsePeriods(undefined, available, "2025")).toEqual(["2025"]);
  });

  it("toggles a period without leaving the selection empty", () => {
    expect(togglePeriod(["2024", "2025"], "2024")).toEqual(["2025"]);
    expect(togglePeriod(["2025"], "2025")).toEqual(["2025"]);
    expect(togglePeriod(["2025"], "2023")).toEqual(["2025", "2023"]);
  });

  it("does not turn a missing year into zero when summing several years", () => {
    expect(sumPeriods(["10.50", "4.25"])).toBe("14.75");
    expect(sumPeriods(["10.50", null])).toBeNull();
    expect(sumPeriods([])).toBeNull();
  });

  it("does not treat a missing previous year as zero growth", () => {
    const ranked = rankGrowth(
      [
        { code: "09", description: "Kopi", usd: "200" },
        { code: "27", description: "Mineral", usd: "50" },
      ],
      [{ code: "27", description: "Mineral", usd: "40" }],
    );
    expect(ranked.map((row) => row.code)).toEqual(["27"]);
    expect(ranked[0]?.growthPct).toBe("25.0000");
  });

  it("groups the tail of one HS level without mixing another level", () => {
    const slices = compositionSlices(
      [
        { code: "27", description: "Mineral", usd: "50" },
        { code: "15", description: "Lemak", usd: "30" },
        { code: "09", description: "Kopi", usd: "20" },
      ],
      2,
    );
    expect(slices.map((slice) => slice.code)).toEqual(["27", "15", "LAINNYA"]);
    expect(slices[2]?.sharePct).toBe("20.00");
  });

  it("ranks commodities that actually have a value", () => {
    const rows = topCommodities(
      [
        { code: "09", description: "Kopi", exportUsd: "10", importUsd: null },
        { code: "27", description: "Mineral", exportUsd: "40", importUsd: "5" },
      ],
      "export",
    );
    expect(rows.map((row) => row.code)).toEqual(["27", "09"]);
    expect(rows[1]?.importMn).toBeNull();
  });
});
