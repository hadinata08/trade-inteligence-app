import { describe, expect, it, vi } from "vitest";
import { ComtradeClient } from "./client";
import { createFixtureSource, fixtureObservations } from "./fixture";
import { backoffMs, normalizeComtradePayload, normalizeHsCode, parseRetryAfter } from "./normalize";
import { estimateRecords, planBackfill, splitInHalf, splitPartners } from "./planner";
import { InMemoryRateLimiter } from "./rate-limit";
import { ComtradeRequestError, QuotaExceededError } from "./types";

describe("HS code normalization", () => {
  it("preserves and restores leading zeros from aggregation level", () => {
    expect(normalizeHsCode("090111", 6)).toBe("090111");
    expect(normalizeHsCode(90111, 6)).toBe("090111");
    expect(normalizeHsCode("TOTAL", 0)).toBe("TOTAL");
    expect(normalizeHsCode("15", 2)).toBe("15");
  });
});

describe("payload normalization", () => {
  const query = {
    frequency: "A" as const,
    periods: ["2024", "2023"],
    partnerCodes: ["156"],
    flowCode: "X,M" as const,
    cmdCode: "TOTAL",
    hsLevel: 0,
    maxRecords: 2,
  };

  it("does not turn a null primary value into zero and flags a truncated 200 response", () => {
    const result = normalizeComtradePayload(
      {
        count: 2,
        error: null,
        data: [
          {
            reporterCode: 360,
            partnerCode: 156,
            period: "2024",
            flowCode: "X",
            cmdCode: "TOTAL",
            cmdDesc: "All",
            aggrLevel: 0,
            primaryValue: null,
            customsCode: "C00",
            motCode: 0,
          },
          {
            reporterCode: 360,
            partnerCode: 156,
            period: "2024",
            flowCode: "M",
            cmdCode: 90111,
            cmdDesc: "Coffee",
            aggrLevel: 6,
            primaryValue: 1500,
            customsCode: "C00",
            motCode: 0,
          },
        ],
      },
      query,
    );
    expect(result.truncated).toBe(true);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.hsCode).toBe("090111");
    expect(result.observations[0]?.tradeValueUsd).toBe("1500.00");
    expect(result.observations.some((row) => row.tradeValueUsd === "0.00")).toBe(false);
    expect(result.periodsMissing).toContain("2023");
  });

  it("keeps conflicting duplicate values out of the stored set", () => {
    const result = normalizeComtradePayload(
      {
        count: 2,
        data: [
          baseRow({ primaryValue: 10 }),
          baseRow({ primaryValue: 12 }),
        ],
      },
      { ...query, maxRecords: 100 },
    );
    expect(result.truncated).toBe(false);
    expect(result.observations).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  it("drops a mismatched reporter instead of storing it", () => {
    const result = normalizeComtradePayload(
      { count: 1, data: [baseRow({ reporterCode: 156, primaryValue: 10 })] },
      { ...query, maxRecords: 100 },
    );
    expect(result.observations).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("reporter"))).toBe(true);
  });
});

describe("rate limiter", () => {
  it("never exceeds the budget under concurrent reservations", async () => {
    const limiter = new InMemoryRateLimiter({ budget: 5, intervalMs: 0, windowMs: 86_400_000, now: () => 1_000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.tryReserve(1_000)));
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    expect(results.filter((result) => !result.ok && result.reason === "budget").length).toBeGreaterThan(0);
  });

  it("does not reset the budget at a local midnight boundary inside the rolling window", async () => {
    let now = Date.parse("2026-10-17T16:30:00.000Z");
    const limiter = new InMemoryRateLimiter({ budget: 1, intervalMs: 0, windowMs: 24 * 60 * 60 * 1000, now: () => now });
    expect((await limiter.tryReserve(now)).ok).toBe(true);
    now = Date.parse("2026-10-18T00:30:00.000Z");
    const blocked = await limiter.tryReserve(now);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("budget");
    now = Date.parse("2026-10-18T16:30:01.000Z");
    expect((await limiter.tryReserve(now)).ok).toBe(true);
  });

  it("honors a cooldown after HTTP 429", async () => {
    const limiter = new InMemoryRateLimiter({ budget: 10, intervalMs: 0, windowMs: 86_400_000, now: () => 5_000 });
    await limiter.penalize(10_000, 5_000);
    const blocked = await limiter.tryReserve(6_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("cooldown");
  });
});

describe("retry timing", () => {
  it("parses Retry-After seconds and keeps jitter inside the backoff cap", () => {
    expect(parseRetryAfter("2", 0)).toBe(2_000);
    const value = backoffMs(3, () => 0);
    expect(value).toBeGreaterThan(0);
    expect(backoffMs(20, () => 1)).toBeLessThanOrEqual(37_500);
  });
});

describe("Comtrade client", () => {
  it("sends the subscription key only as a header and retries HTTP 429", async () => {
    const calls: string[] = [];
    let attempt = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect(url.includes("subscription-key")).toBe(false);
      const headers = new Headers(init?.headers);
      expect(headers.get("Ocp-Apim-Subscription-Key")).toBe("test-key");
      attempt += 1;
      if (attempt === 1) {
        return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ count: 1, data: [baseRow({ primaryValue: 25 })] }), { status: 200 });
    });
    let now = Date.now();
    const client = new ComtradeClient({
      apiKey: "test-key",
      rateLimiter: new InMemoryRateLimiter({ budget: 10, intervalMs: 0, windowMs: 60_000, now: () => now }),
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async (ms: number) => {
        now += ms;
      },
      random: () => 0,
      maxRetries: 2,
    });
    const result = await client.getTrade({
      frequency: "A",
      periods: ["2024"],
      partnerCodes: ["156"],
      flowCode: "X",
      cmdCode: "TOTAL",
      hsLevel: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.observations[0]?.tradeValueUsd).toBe("25.00");
    expect(calls[0]).toContain("https://comtradeapi.un.org/data/v1/get/C/A/HS");
  });

  it("blocks a non-allowlisted host before any request", async () => {
    const fetchImpl = vi.fn();
    const client = new ComtradeClient({
      apiKey: "test-key",
      baseUrl: "https://127.0.0.1",
      rateLimiter: new InMemoryRateLimiter({ budget: 5, intervalMs: 0, windowMs: 60_000 }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(
      client.getTrade({
        frequency: "A",
        periods: ["2024"],
        partnerCodes: ["156"],
        flowCode: "X",
        cmdCode: "TOTAL",
        hsLevel: 0,
      }),
    ).rejects.toBeInstanceOf(ComtradeRequestError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call the network when the daily budget is exhausted", async () => {
    const fetchImpl = vi.fn();
    const limiter = new InMemoryRateLimiter({ budget: 0, intervalMs: 0, windowMs: 60_000 });
    const client = new ComtradeClient({
      apiKey: "test-key",
      rateLimiter: limiter,
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(
      client.getAvailability("A", ["2024"]),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("planner", () => {
  it("splits partners into non-overlapping batches under the record ceiling", () => {
    const partners = ["1", "2", "3", "4", "5", "6"];
    const chunks = splitPartners(partners, "AG6", 1, 2, 100_000);
    expect(chunks.flat().sort()).toEqual(partners);
    expect(new Set(chunks.flat()).size).toBe(partners.length);
    for (const chunk of chunks) {
      expect(estimateRecords(chunk.length, "AG6", 1, 2)).toBeLessThanOrEqual(80_000);
    }
    const [left, right] = splitInHalf(partners);
    expect([...left, ...right]).toEqual(partners);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
  });

  it("plans TOTAL before HS6 and keeps one worksheet-sized partner set for a small fixture", () => {
    const plan = planBackfill(["156", "392"], 100_000);
    const stages = plan.map((job) => job.stage);
    expect(stages.indexOf("B")).toBeLessThan(stages.indexOf("E"));
    expect(plan.some((job) => job.kind === "partners")).toBe(true);
    expect(plan.some((job) => job.kind === "tariff-availability")).toBe(true);
    expect(plan.filter((job) => job.cmdCode === "TOTAL").length).toBeGreaterThan(0);
    const keys = new Set(plan.map((job) => job.key));
    expect(keys.size).toBe(plan.length);
    expect([...keys].every((key) => !key.includes(":"))).toBe(true);
  });
});

describe("fixture source", () => {
  it("builds deterministic values with leading-zero HS codes and a world total that is not the bilateral sum", () => {
    const rows = fixtureObservations();
    const coffee = rows.find((row) => row.partnerCode === "156" && row.periodCode === "2024" && row.hsCode === "090111" && row.flow === "EXPORT");
    expect(coffee?.hsCode).toBe("090111");
    expect(coffee?.tradeValueUsd).not.toBe("0.00");
    const again = fixtureObservations();
    expect(again[0]?.tradeValueUsd).toBe(rows[0]?.tradeValueUsd);
    const bilateral = rows
      .filter((row) => row.periodCode === "2024" && row.hsCode === "TOTAL" && row.flow === "EXPORT" && row.partnerCode !== "0")
      .reduce((sum, row) => sum + Number(row.tradeValueUsd), 0);
    const world = rows.find((row) => row.partnerCode === "0" && row.periodCode === "2024" && row.hsCode === "TOTAL" && row.flow === "EXPORT");
    expect(Number(world?.tradeValueUsd)).toBeGreaterThan(bilateral);
  });

  it("returns only the requested level from the fixture client", async () => {
    const source = createFixtureSource();
    const result = await source.getTrade({
      frequency: "A",
      periods: ["2024"],
      partnerCodes: ["156"],
      flowCode: "X,M",
      cmdCode: "AG2",
      hsLevel: 2,
    });
    expect(result.truncated).toBe(false);
    expect(result.observations.every((row) => row.hsLevel === 2)).toBe(true);
    expect(result.observations.some((row) => row.hsCode === "09")).toBe(true);
    expect(result.observations.some((row) => row.hsCode === "090111")).toBe(false);
  });
});

function baseRow(overrides: Record<string, unknown>) {
  return {
    reporterCode: 360,
    partnerCode: 156,
    period: "2024",
    flowCode: "X",
    cmdCode: "TOTAL",
    cmdDesc: "Total",
    aggrLevel: 0,
    customsCode: "C00",
    motCode: 0,
    primaryValue: 10,
    ...overrides,
  };
}
