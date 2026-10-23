"use client";

import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Sistem Nila–Soga: warna hanya untuk aliran. Nilai literal karena Recharts menulis atribut SVG.
export const EXPORT_COLOR = "oklch(0.42 0.09 262)";
export const IMPORT_COLOR = "oklch(0.56 0.10 58)";
export const BALANCE_COLOR = "oklch(0.20 0.012 255)";
const GRID = "oklch(0.92 0.004 250)";
const TICK = { fontSize: 12, fill: "oklch(0.45 0.012 255)" };

type Point = { label: string; exportMn: number | null; importMn: number | null; balanceMn: number | null };

/** Label sumbu dalam juta USD. "rb" = ribu juta, hanya bila puncak seri ≥ 1.000 agar nilai kecil tidak membulat jadi 0. */
function axisTicks(maxAbs: number) {
  const thousands = maxAbs >= 1000;
  const digits = thousands ? (maxAbs >= 10_000 ? 0 : 1) : maxAbs >= 100 ? 0 : maxAbs >= 10 ? 1 : 2;
  return (value: number | string) => {
    const shown = thousands ? Number(value) / 1000 : Number(value);
    const text = new Intl.NumberFormat("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(shown);
    return thousands ? `${text} rb` : text;
  };
}

function seriesMax(rows: Array<Record<string, string | number | null>>) {
  let max = 0;
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "number" && Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
  }
  return max;
}

const UNIT_LABEL = { value: "juta USD", angle: -90, position: "insideLeft", style: { textAnchor: "middle", ...TICK } } as const;

function million(value: number | string) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

const tooltipStyle = { borderRadius: 6, border: "1px solid oklch(0.85 0.005 250)", boxShadow: "none", fontSize: 13 };

/** Batang ekspor/impor berpasangan dan garis neraca lurus, satu rentang tahun dengan grafik tren. */
export function PerformanceCombo({ points }: { points: Point[] }) {
  const data = points.map((point) => ({ label: point.label, Ekspor: point.exportMn, Impor: point.importMn, Neraca: point.balanceMn }));
  if (!data.some((row) => row.Ekspor != null || row.Impor != null || row.Neraca != null)) {
    return <p className="text-sm text-ink/60">Belum ada observasi tahunan untuk pilihan ini.</p>;
  }
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tickFormatter={axisTicks(seriesMax(data))} width={72} tick={TICK} tickLine={false} axisLine={false} label={UNIT_LABEL} />
          <Tooltip formatter={(value) => `${million(Number(value))} juta USD`} contentStyle={tooltipStyle} cursor={{ fill: "oklch(0.96 0.005 250)" }} />
          <Bar dataKey="Ekspor" fill={EXPORT_COLOR} maxBarSize={26} isAnimationActive={false} />
          <Bar dataKey="Impor" fill={IMPORT_COLOR} maxBarSize={26} isAnimationActive={false} />
          <Line type="linear" dataKey="Neraca" stroke={BALANCE_COLOR} strokeWidth={2} dot={{ r: 3.5, fill: "#fff", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AnnualTrend({ points, showBalance = false }: { points: Point[]; showBalance?: boolean }) {
  const data = points.map((point) => ({ label: point.label, Ekspor: point.exportMn, Impor: point.importMn, Neraca: point.balanceMn }));
  if (!data.length) return <p className="text-sm text-ink/60">Belum ada observasi tersimpan untuk grafik ini.</p>;
  const dot = { r: 3.5, fill: "#fff", strokeWidth: 2 };
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tickFormatter={axisTicks(seriesMax(data))} width={72} tick={TICK} tickLine={false} axisLine={false} label={UNIT_LABEL} />
          <Tooltip formatter={(value) => `${million(Number(value))} juta USD`} contentStyle={tooltipStyle} />
          <Line type="linear" dataKey="Ekspor" stroke={EXPORT_COLOR} strokeWidth={2.5} dot={dot} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="Impor" stroke={IMPORT_COLOR} strokeWidth={2.5} dot={dot} connectNulls={false} isAnimationActive={false} />
          {showBalance ? <Line type="linear" dataKey="Neraca" stroke={BALANCE_COLOR} strokeWidth={2} strokeDasharray="5 3" dot={dot} connectNulls={false} isAnimationActive={false} /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
