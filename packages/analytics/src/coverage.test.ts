import { describe, expect, it } from "vitest";
import { compareTotalWithLevel, cumulativeMonths } from "@iti/shared";

describe("coverage comparisons stay explicit", () => {
  it("reports a TOTAL versus HS2 gap without rewriting either figure", () => {
    const gap = compareTotalWithLevel("100.00", "96.00");
    expect(gap.differenceUsd).toBe("4.00");
    expect(gap.comparable).toBe(true);
  });

  it("does not publish a cumulative total when February is missing", () => {
    const result = cumulativeMonths([
      { month: 1, exportUsd: "8.00", importUsd: "3.00", verified: true },
      { month: 2, exportUsd: null, importUsd: null, verified: false },
    ]);
    expect(result.status).toBe("PARTIAL");
    expect(result.exportUsd).toBeNull();
  });
});
