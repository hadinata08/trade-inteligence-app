import { DEFAULT_MAX_RECORDS, REPORTER, fingerprint } from "@iti/shared";
import { backoffMs, normalizeComtradePayload, parseRetryAfter } from "./normalize";
import { bundledPartners, parsePartnerReference } from "./reference";
import type { RateLimiter } from "./rate-limit";
import {
  ComtradeRequestError,
  QuotaExceededError,
  type NormalizeResult,
  type TariffAvailability,
  type TradeQuery,
  type TradeSource,
} from "./types";

export type UsageLog = {
  requestId: string;
  endpoint: string;
  requestFingerprint: string;
  statusCode: number;
  recordsReceived: number;
  retryCount: number;
  durationMs: number;
  quotaRemaining: number | null;
  errorMessage: string | null;
};

type ClientOptions = {
  apiKey: string;
  baseUrl?: string;
  allowedHosts?: string[];
  maxRecords?: number;
  rateLimiter: RateLimiter;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  usageLogger?: (entry: UsageLog) => Promise<void>;
  random?: () => number;
};

export class ComtradeClient implements TradeSource {
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly allowedHosts: string[];
  private readonly maxRecords: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = (options.baseUrl || "https://comtradeapi.un.org").replace(/\/$/, "");
    this.allowedHosts = options.allowedHosts?.length ? options.allowedHosts : ["comtradeapi.un.org"];
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? 3;
  }

  async getPartners() {
    const payload = await this.requestJson("/files/v1/app/reference/partnerAreas.json", {});
    const parsed = parsePartnerReference(payload);
    return parsed.length ? parsed : bundledPartners();
  }

  async getAvailability(frequency: "A" | "M", periods: string[]) {
    const payload = await this.requestJson(`/data/v1/getDa/C/${frequency}/HS`, {
      reporterCode: REPORTER.code,
      period: periods.join(","),
    });
    return { scope: `DA-${frequency}-${periods.join(",")}`, payload };
  }

  async getTariffAvailability(): Promise<TariffAvailability> {
    try {
      const payload = await this.requestJson("/data/v1/getDaTariffline/C/A/HS", {
        reporterCode: REPORTER.code,
        period: "2024",
      });
      const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
      const supported = Array.isArray(data) && data.length > 0;
      return {
        supported,
        status: supported ? "UNVERIFIED" : "UNAVAILABLE",
        reason: supported
          ? "Tariff-line availability returned rows. HS8 download still has to be confirmed per partition."
          : "UN Comtrade returned no tariff-line availability for Indonesia in 2024.",
      };
    } catch (error) {
      const status = error instanceof ComtradeRequestError ? error.statusCode : 0;
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        return {
          supported: false,
          status: "UNAVAILABLE",
          reason: `Tariff-line availability is not accessible on this subscription (HTTP ${status}).`,
        };
      }
      throw error;
    }
  }

  async getTrade(query: TradeQuery): Promise<NormalizeResult> {
    const payload = await this.requestJson(`/data/v1/get/C/${query.frequency}/HS`, {
      reporterCode: REPORTER.code,
      period: query.periods.join(","),
      partnerCode: query.partnerCodes.join(","),
      partner2Code: "0",
      cmdCode: query.cmdCode,
      flowCode: query.flowCode,
      customsCode: "C00",
      motCode: "0",
      maxRecords: String(this.maxRecords),
      includeDesc: "true",
      format: "JSON",
    });
    return normalizeComtradePayload(payload, { ...query, maxRecords: this.maxRecords, sourceKind: "UN_COMTRADE" });
  }

  private async requestJson(pathname: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(this.baseUrl + pathname);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    this.assertAllowed(url);
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let reservation: { reservationId: string; remaining: number } | null = null;
      const started = Date.now();
      let statusCode = 0;
      let errorMessage: string | null = null;
      let recordsReceived = 0;
      try {
        reservation = await this.acquire();
        const response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          headers: {
            Accept: "application/json",
            "Ocp-Apim-Subscription-Key": this.options.apiKey,
            "User-Agent": "indonesia-trade-intelligence/1.0",
          },
        });
        statusCode = response.status;
        if (response.status >= 300 && response.status < 400) {
          throw new ComtradeRequestError("Redirects are not followed.", response.status, false);
        }
        if (response.status === 429) {
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          await this.options.rateLimiter.penalize(retryAfter);
          errorMessage = "HTTP 429";
          if (attempt === this.maxRetries) {
            throw new ComtradeRequestError("UN Comtrade rate limit persisted after retries.", 429, true);
          }
          await this.sleep(retryAfter + backoffMs(attempt, this.options.random));
          continue;
        }
        const text = await response.text();
        if (response.status >= 500 && attempt < this.maxRetries) {
          errorMessage = `HTTP ${response.status}`;
          await this.sleep(backoffMs(attempt, this.options.random));
          continue;
        }
        if (!response.ok) {
          throw new ComtradeRequestError(`UN Comtrade HTTP ${response.status}`, response.status, response.status >= 500);
        }
        const json = text ? (JSON.parse(text) as unknown) : {};
        if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
          recordsReceived = (json as { data: unknown[] }).data.length;
        }
        return json;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error instanceof ComtradeRequestError && !error.retryable) throw error;
        if (error instanceof QuotaExceededError) throw error;
        if (attempt === this.maxRetries) throw lastError;
        errorMessage = lastError.message;
        await this.sleep(backoffMs(attempt, this.options.random));
      } finally {
        if (reservation) {
          await this.options.usageLogger?.({
            requestId: reservation.reservationId,
            endpoint: pathname,
            requestFingerprint: fingerprint({ pathname, query }),
            statusCode,
            recordsReceived,
            retryCount: attempt,
            durationMs: Date.now() - started,
            quotaRemaining: reservation.remaining,
            errorMessage,
          });
        }
      }
    }
    throw lastError ?? new ComtradeRequestError("UN Comtrade request failed.", 0, true);
  }

  private async acquire() {
    for (let spin = 0; spin < 40; spin += 1) {
      const result = await this.options.rateLimiter.tryReserve();
      if (result.ok) return result;
      if (result.reason === "interval" || result.reason === "cooldown") {
        const wait = Math.min(result.retryAtMs, 20_000);
        if (spin < 39 && result.retryAtMs <= 20_000) {
          await this.sleep(wait);
          continue;
        }
      }
      throw new QuotaExceededError(
        `UN Comtrade quota blocked the request (${result.reason}).`,
        result.retryAtMs,
        result.reason === "interval" ? "interval" : result.reason,
      );
    }
    throw new QuotaExceededError("UN Comtrade quota blocked the request.", 60_000, "budget");
  }

  private assertAllowed(url: URL) {
    if (url.username || url.password) throw new ComtradeRequestError("Credentials in the URL are not allowed.", 0, false);
    if (url.protocol !== "https:") throw new ComtradeRequestError("Only HTTPS Comtrade endpoints are allowed.", 0, false);
    if (!this.allowedHosts.includes(url.hostname)) {
      throw new ComtradeRequestError(`Blocked host ${url.hostname}.`, 0, false);
    }
    if (url.searchParams.has("subscription-key")) {
      throw new ComtradeRequestError("The API key must not be placed in the query string.", 0, false);
    }
  }
}

export function createNoopLimiter(): RateLimiter {
  return {
    async tryReserve() {
      return { ok: true, remaining: 1, reservationId: "noop" };
    },
    async remaining() {
      return 1;
    },
    async penalize() {
      return undefined;
    },
  };
}
