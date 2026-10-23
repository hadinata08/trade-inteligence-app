"use client";

import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Select yang langsung mengirim form induknya (filter berbasis URL tanpa tombol tambahan). */
export function SubmitOnChangeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn("h-10 rounded-md border border-ink/25 bg-card px-3 text-sm", className)}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    />
  );
}

/** Select negara yang berpindah ke /countries/{kode} sambil mempertahankan filter lain. */
export function CountryNavigateSelect({ value, query, options }: { value: string; query: string; options: Array<{ code: string; name: string }> }) {
  return (
    <select
      aria-label="Negara mitra"
      defaultValue={value}
      className="h-10 w-full rounded-md border border-ink/25 bg-card px-3 text-sm"
      onChange={(event) => {
        window.location.assign(`/countries/${encodeURIComponent(event.currentTarget.value)}${query ? `?${query}` : ""}`);
      }}
    >
      {options.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
    </select>
  );
}
