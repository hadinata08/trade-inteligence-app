import { z } from "zod";
import { allSourcePeriodCodes, CUMULATIVE_2026 } from "./constants";

const periodCode = z.string().regex(/^(\d{4}|\d{6}|2026M01-08)$/);

export const ExportFiltersSchema = z.object({
  preset: z.enum(["full", "custom"]).default("custom"),
  allPartners: z.boolean().default(false),
  partnerCodes: z.array(z.string().regex(/^\d{1,4}$/)).max(400).default([]),
  periods: z.array(periodCode).max(40).default([]),
  hsLevels: z.array(z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6), z.literal(8)])).default([0, 2, 4, 6]),
  includeHs8: z.boolean().default(false),
  includeCharts: z.boolean().default(true),
  includeDetail: z.boolean().default(true),
  includeCoverage: z.boolean().default(true),
});

export type ExportFilters = z.infer<typeof ExportFiltersSchema>;

export function fullReportFilters(): ExportFilters {
  return ExportFiltersSchema.parse({
    preset: "full",
    allPartners: true,
    partnerCodes: [],
    periods: [...allSourcePeriodCodes(), CUMULATIVE_2026.code],
    hsLevels: [0, 2, 4, 6, 8],
    includeHs8: true,
    includeCharts: true,
    includeDetail: true,
    includeCoverage: true,
  });
}

export const SyncActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start-backfill") }),
  z.object({ action: z.literal("load-fixture") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("retry-failed") }),
  z.object({ action: z.literal("retry-incomplete") }),
  z.object({ action: z.literal("refresh-country"), partnerCode: z.string().regex(/^\d{1,4}$/) }),
  z.object({ action: z.literal("refresh-period"), periodCode: periodCode }),
]);

export type SyncAction = z.infer<typeof SyncActionSchema>;

export const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), "Email tidak valid."),
  password: z.string().min(12).max(200),
});
