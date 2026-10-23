import type { IncomingObservation } from "@iti/database";
import type { QueueName } from "@iti/shared";

export type TradeQuery = {
  frequency: "A" | "M";
  periods: string[];
  partnerCodes: string[];
  flowCode: "X" | "M" | "X,M";
  cmdCode: string;
  hsLevel: number;
};

export type NormalizeResult = {
  observations: IncomingObservation[];
  conflicts: Array<{ identityKey: string; values: string[] }>;
  truncated: boolean;
  count: number;
  warnings: string[];
  periodsPresent: string[];
  periodsMissing: string[];
  metadata: Record<string, unknown>;
};

export type TariffAvailability = {
  supported: boolean;
  status: "UNAVAILABLE" | "UNVERIFIED" | "PARTIAL";
  reason: string;
};

export interface TradeSource {
  mode: "live" | "fixture";
  getPartners(): Promise<
    Array<{
      m49Code: string;
      partnerName: string;
      iso2: string | null;
      iso3: string | null;
      entityType: "COUNTRY" | "TERRITORY" | "AGGREGATE" | "OTHER";
    }>
  >;
  getAvailability(frequency: "A" | "M", periods: string[]): Promise<{ scope: string; payload: unknown }>;
  getTariffAvailability(): Promise<TariffAvailability>;
  getTrade(query: TradeQuery): Promise<NormalizeResult>;
}

export type SyncPartition = {
  key: string;
  queue: QueueName;
  stage: "A" | "B" | "C" | "D" | "E" | "F" | "R";
  kind: "partners" | "availability" | "tariff-availability" | "trade" | "reconcile";
  frequency?: "A" | "M";
  periods: string[];
  partnerCodes: string[];
  flowCode?: "X" | "M" | "X,M";
  cmdCode?: string;
  hsLevel?: number;
  priority: number;
  force?: boolean;
};

export class ComtradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComtradeError";
  }
}

export class QuotaExceededError extends ComtradeError {
  constructor(
    message: string,
    readonly retryAtMs: number,
    readonly reason: "budget" | "cooldown" | "interval",
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export class ComtradeRequestError extends ComtradeError {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ComtradeRequestError";
  }
}
