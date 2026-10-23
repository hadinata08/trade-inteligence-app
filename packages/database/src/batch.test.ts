import { describe, expect, it } from "vitest";
import { prepareObservationBatch, type IncomingObservation } from "./batch";

function row(overrides: Partial<IncomingObservation>): IncomingObservation {
  return {
    reporterCode: "360",
    partnerCode: "156",
    secondPartnerCode: "0",
    periodCode: "2024",
    frequency: "ANNUAL",
    year: 2024,
    month: null,
    flow: "EXPORT",
    hsCode: "090111",
    hsLevel: 6,
    parentCode: "0901",
    description: "Coffee",
    classificationCode: "H6",
    customsCode: "C00",
    transportMode: "0",
    tradeValueUsd: "10.00",
    quantity: null,
    netWeight: null,
    sourceStatus: "REPORTED",
    sourceUpdatedAt: null,
    isReported: true,
    sourceKind: "FIXTURE",
    ...overrides,
  };
}

describe("prepareObservationBatch", () => {
  it("dedupes identical observations and preserves the HS code text", () => {
    const prepared = prepareObservationBatch([
      row({ tradeValueUsd: "10" }),
      row({ tradeValueUsd: "10.00" }),
    ]);
    expect(prepared.conflicts).toHaveLength(0);
    expect(prepared.ready).toHaveLength(1);
    expect(prepared.ready[0]?.hsCode).toBe("090111");
    expect(prepared.ready[0]?.tradeValueUsd).toBe("10.00");
  });

  it("does not merge distinct values for the same observation identity", () => {
    const prepared = prepareObservationBatch([
      row({ tradeValueUsd: "10.00" }),
      row({ tradeValueUsd: "12.50" }),
    ]);
    expect(prepared.ready).toHaveLength(0);
    expect(prepared.conflicts).toHaveLength(1);
    expect(prepared.conflicts[0]?.values.sort()).toEqual(["10.00", "12.50"]);
  });

  it("drops null values instead of storing them as zero", () => {
    const prepared = prepareObservationBatch([row({ tradeValueUsd: null })]);
    expect(prepared.ready).toHaveLength(0);
    expect(prepared.conflicts).toHaveLength(0);
  });

  it("keeps two flows as separate observations", () => {
    const prepared = prepareObservationBatch([
      row({ flow: "EXPORT", tradeValueUsd: "5.00" }),
      row({ flow: "IMPORT", tradeValueUsd: "5.00" }),
    ]);
    expect(prepared.ready).toHaveLength(2);
  });
});
