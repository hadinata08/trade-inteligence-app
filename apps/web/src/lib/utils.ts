import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMn(value: string | number | null | undefined): string {
  if (value == null || value === "") return "n.a.";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "n.a.";
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
}

export function formatPct(value: string | null | undefined): string {
  if (value == null) return "n.a.";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(value))}%`;
}

/** Juta USD tanpa desimal, untuk batang peringkat. */
export function formatMnWhole(value: string | number | null | undefined): string {
  if (value == null || value === "") return "n.a.";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "n.a.";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(numeric);
}
