export const REPORTER = {
  code: "360",
  name: "Indonesia",
  iso2: "ID",
  iso3: "IDN",
} as const;

/** Official free-tier ceiling published by UN Comtrade. Do not raise the client above this. */
export const PROVIDER_DAILY_LIMIT = 500;
export const PROVIDER_MAX_RECORDS = 100_000;
export const PROVIDER_MIN_INTERVAL_MS = 1_000;

/** Leave 50 calls of the 500-call day for manual checks and unexpected retries. */
export const DEFAULT_DAILY_BUDGET = 450;
export const DEFAULT_MIN_INTERVAL_MS = 1_500;
export const DEFAULT_MAX_RECORDS = 100_000;
export const DEFAULT_QUOTA_WINDOW_HOURS = 24;

export const USD_PER_MILLION = "1000000";

export const ANNUAL_YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const;
export const MONTHLY_2026 = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export const CUMULATIVE_2026 = {
  code: "2026M01-08",
  label: "2026 Jan–Agt (kumulatif)",
  year: 2026,
  months: MONTHLY_2026,
} as const;

export const QUEUE_NAMES = {
  partnerSync: "partner-sync",
  hsReferenceSync: "hs-reference-sync",
  annualTradeSync: "annual-trade-sync",
  monthlyTradeSync: "monthly-trade-sync",
  commodityDetailSync: "commodity-detail-sync",
  reconciliation: "reconciliation",
  excelGeneration: "excel-generation",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const SYNC_QUEUES: QueueName[] = [
  QUEUE_NAMES.partnerSync,
  QUEUE_NAMES.hsReferenceSync,
  QUEUE_NAMES.annualTradeSync,
  QUEUE_NAMES.monthlyTradeSync,
  QUEUE_NAMES.commodityDetailSync,
  QUEUE_NAMES.reconciliation,
];

export const HS_LEVELS = [2, 4, 6, 8] as const;
export type HsLevel = (typeof HS_LEVELS)[number];

export const COMPLETENESS = [
  "COMPLETE",
  "PARTIAL",
  "MISSING",
  "UNAVAILABLE",
  "UNVERIFIED",
  "FAILED",
] as const;
export type CompletenessStatus = (typeof COMPLETENESS)[number];

export const FLOW = ["EXPORT", "IMPORT"] as const;
export type TradeFlow = (typeof FLOW)[number];

export const SOURCE_KIND = ["UN_COMTRADE", "FIXTURE"] as const;
export type SourceKind = (typeof SOURCE_KIND)[number];

/** Safety margin so a response is not planned up to the hard 100k truncation edge. */
export const PLAN_RECORD_FILL = 0.8;

export const EXCEL_MAX_ROWS = 1_048_576;
export const EXCEL_MAX_COLUMNS = 16_384;
export const EXCEL_MAX_SHEET_NAME = 31;
/** Practical rows per generated workbook so generation stays inside worker memory. */
export const EXCEL_PRACTICAL_ROWS = 200_000;

export function annualPeriodCode(year: number): string {
  return String(year);
}

export function monthlyPeriodCode(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
}

export function periodLabel(code: string): string {
  if (code === CUMULATIVE_2026.code) return CUMULATIVE_2026.label;
  if (/^\d{6}$/.test(code)) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

export function allSourcePeriodCodes(): string[] {
  return [
    ...ANNUAL_YEARS.map((year) => annualPeriodCode(year)),
    ...MONTHLY_2026.map((month) => monthlyPeriodCode(2026, month)),
  ];
}

export function defaultAnnualPeriods(): string[] {
  return ANNUAL_YEARS.map((year) => annualPeriodCode(year));
}

export function defaultMonthlyPeriods(): string[] {
  return MONTHLY_2026.map((month) => monthlyPeriodCode(2026, month));
}
