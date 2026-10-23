import type { ReactNode } from "react";
import Link from "next/link";
import { cn, formatMn, formatPct } from "@/lib/utils";

/*
 * Sistem Nila–Soga (design-demos/direction-approved.md).
 * Rel filter kiri + grid 12 kolom berpanel garis rambut; nila = ekspor, soga = impor, tinta = neraca.
 */

type Slice = { name: string; description: string; valueMn: string; sharePct: string };
type GrowthRow = { code: string; description: string; growthPct: string };
type CommodityRow = { rank: number; code: string; description: string; exportMn: string | null; importMn: string | null };
type Flow = "export" | "import";

/** Tata letak halaman analitik: rel filter putih selebar layar di kiri, isi di kanan. */
export function RailLayout({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-4 -my-6 grid min-h-[calc(100vh-3.5rem)] sm:-mx-6 lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 border-b border-line bg-card px-4 py-5 sm:px-6 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-5" aria-label="Filter">
        {rail}
      </aside>
      <div className="min-w-0 px-4 pb-12 pt-6 sm:px-8 lg:px-9">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </div>
    </div>
  );
}

export function RailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold text-ink/70">{label}</p>
      {children}
    </div>
  );
}

/** Tombol pilihan (tahun) berbentuk tautan URL; bisa lebih dari satu aktif. */
export function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-pressed={active}
      className={cn(
        "flex min-h-10 items-center justify-center rounded-md border px-2 text-sm font-medium",
        active ? "border-ink bg-ink text-white" : "border-ink/20 bg-card text-ink/75 hover:border-ink/50",
      )}
    >
      {children}
    </Link>
  );
}

/** Kontrol bersegmen satu-pilihan (Level HS). */
export function Segmented({ items }: { items: Array<{ href: string; label: string; active: boolean }> }) {
  return (
    <div className="grid overflow-hidden rounded-md border border-ink/20" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item, index) => (
        <Link
          key={item.label}
          href={item.href}
          scroll={false}
          aria-pressed={item.active}
          className={cn("flex min-h-10 items-center justify-center text-sm font-medium", index > 0 && "border-l border-ink/20", item.active ? "bg-ink text-white" : "bg-card text-ink/75 hover:bg-paper")}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function DataStatus({ sourceKind, lastSyncedAt, notes }: { sourceKind: string; lastSyncedAt: string | null; notes?: string | null }) {
  const official = sourceKind === "UN_COMTRADE";
  return (
    <div className="mt-auto border-t border-line pt-4 text-xs leading-relaxed text-ink/60">
      <p className={cn("font-semibold", official ? "text-ink/80" : "text-clay")}>{official ? "UN Comtrade Plus" : sourceKind === "FIXTURE" ? "DATA CONTOH, bukan statistik resmi" : "Belum ada data"}</p>
      <p>Klasifikasi HS H6, sinkron {lastSyncedAt ? new Date(lastSyncedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "belum ada"}</p>
      <p>Nilai dalam juta USD</p>
      {notes && !official ? <p className="mt-2">{notes}</p> : null}
    </div>
  );
}

export function FlowLegend({ balance = true }: { balance?: boolean }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-ink/70">
      <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-nila" />Ekspor</span>
      <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-soga" />Impor</span>
      {balance ? <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-ink" />Neraca</span> : null}
    </div>
  );
}

export function PageHead({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-ink/20 pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
        {note ? <p className="mt-1 text-sm text-ink/70">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

type Kpi = { label: string; value: string; unit?: string; note?: string; flow?: Flow };

/** Pita KPI: empat sel dipisah garis rambut; ekspor/impor bergaris bawah warna alirannya. */
export function KpiBand({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 border-b border-line xl:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0 py-5 pr-4",
            index % 2 === 1 && "border-l border-line pl-4",
            index >= 2 && "border-t border-line xl:border-t-0",
            index === 2 && "xl:border-l xl:pl-5",
            index > 0 && "xl:pl-5",
            item.flow === "export" && "shadow-[inset_0_-3px_0_oklch(var(--nila))]",
            item.flow === "import" && "shadow-[inset_0_-3px_0_oklch(var(--soga))]",
          )}
        >
          <p className="text-[13px] font-medium text-ink/70">{item.label}</p>
          <p className="mt-1.5 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-[30px]">
            {item.value}
            {item.unit && item.value !== "n.a." ? <span className="ml-1.5 font-sans text-[13px] font-medium tracking-normal text-ink/55">{item.unit}</span> : null}
          </p>
          {item.note ? <p className="mt-1.5 text-[13px] text-ink/55">{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** Panel isi: dipisah garis rambut, tanpa kartu. */
export function Panel({ title, sub, className, children }: { title: string; sub?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("min-w-0 border-b border-line py-7", className)}>
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      {sub ? <p className="mb-4 mt-1 text-[13px] text-ink/70">{sub}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

/** Tangga terang delapan langkah dalam satu rona; irisan "Lainnya" abu netral. */
function shade(flow: Flow, index: number, isOther: boolean) {
  if (isOther) return "oklch(0.89 0.004 250)";
  const hue = flow === "export" ? 262 : 58;
  const chroma = flow === "export" ? 0.09 : 0.1;
  return `oklch(${(0.38 + index * 0.065).toFixed(3)} ${(chroma - index * 0.006).toFixed(3)} ${hue})`;
}

function clipLabel(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

type PieLabel = {
  slice: Slice;
  color: string;
  start: number;
  end: number;
  mid: number;
  right: boolean;
  preferredY: number;
  y: number;
};

const PIE_W = 860;
const PIE_CX = 430;
const PIE_R = 118;
const LABEL_GAP = 36;

function piePoint(angle: number, radius: number) {
  return { x: PIE_CX + Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function relaxLabels(group: PieLabel[]) {
  if (!group.length) return;
  group.sort((left, right) => left.preferredY - right.preferredY);
  for (const item of group) item.y = item.preferredY;
  for (let index = 1; index < group.length; index += 1) {
    group[index].y = Math.max(group[index].y, group[index - 1].y + LABEL_GAP);
  }
}

function layoutPie(flow: Flow, slices: Slice[]): { items: PieLabel[]; height: number; cy: number } {
  const total = slices.reduce((sum, slice) => sum + Number(slice.valueMn), 0);
  let angle = -Math.PI / 2;
  const items: PieLabel[] = slices.map((slice, index) => {
    const sweep = total > 0 ? (Number(slice.valueMn) / total) * Math.PI * 2 : 0;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const mid = (start + end) / 2;
    const anchor = piePoint(mid, PIE_R + 26);
    return {
      slice,
      color: shade(flow, index, slice.name === "Lainnya"),
      start,
      end,
      mid,
      right: Math.cos(mid) >= 0,
      preferredY: anchor.y,
      y: anchor.y,
    };
  });
  relaxLabels(items.filter((item) => item.right));
  relaxLabels(items.filter((item) => !item.right));
  const lows = items.map((item) => item.y + 18);
  const highs = items.map((item) => item.y - 12);
  const minY = Math.min(-PIE_R - 8, ...highs);
  const maxY = Math.max(PIE_R + 8, ...lows);
  const cy = -minY + 8;
  for (const item of items) item.y += cy;
  return { items, height: maxY - minY + 20, cy };
}

function arcPath(cy: number, start: number, end: number) {
  const sweep = end - start;
  if (sweep >= Math.PI * 2 - 0.001) return "";
  const from = { x: PIE_CX + Math.cos(start) * PIE_R, y: cy + Math.sin(start) * PIE_R };
  const to = { x: PIE_CX + Math.cos(end) * PIE_R, y: cy + Math.sin(end) * PIE_R };
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${PIE_CX} ${cy} L ${from.x} ${from.y} A ${PIE_R} ${PIE_R} 0 ${large} 1 ${to.x} ${to.y} Z`;
}

function CompositionPie({ flow, slices }: { flow: Flow; slices: Slice[] }) {
  const total = slices.reduce((sum, slice) => sum + Number(slice.valueMn), 0);
  const title = flow === "export" ? "Ekspor" : "Impor";
  if (!slices.length || total <= 0) return <p className="text-sm text-ink/60">Belum ada komposisi {title.toLowerCase()} pada level ini.</p>;
  const { items, height, cy } = layoutPie(flow, slices);
  const full = slices.length === 1 || items[0].end - items[0].start >= Math.PI * 2 - 0.001;
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex justify-between gap-4 text-sm font-semibold">
        {title}
        <span className="font-medium text-ink/55">{formatMn(total)} juta USD</span>
      </h3>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${PIE_W} ${height}`} className="h-auto w-full min-w-[820px] text-ink" role="img" aria-label={`Pie komposisi ${title.toLowerCase()} per kode HS`}>
          {full ? <circle cx={PIE_CX} cy={cy} r={PIE_R} fill={items[0]?.color} /> : items.map((item) => (
            <path key={item.slice.name} d={arcPath(cy, item.start, item.end)} fill={item.color} stroke="#fff" strokeWidth="2" />
          ))}
          {items.map((item) => {
            const edge = { x: PIE_CX + Math.cos(item.mid) * PIE_R, y: cy + Math.sin(item.mid) * PIE_R };
            const x = item.right ? PIE_CX + PIE_R + 28 : PIE_CX - PIE_R - 28;
            const bend = item.right ? x - 12 : x + 12;
            const shown = clipLabel(item.slice.description, 32);
            const detail = `${item.slice.name === "Lainnya" ? "Lainnya" : `HS ${item.slice.name}`} ${item.slice.description}: ${formatMn(item.slice.valueMn)} juta USD, ${formatPct(item.slice.sharePct)}`;
            return (
              <g key={`label-${item.slice.name}`}>
                <title>{detail}</title>
                <polyline points={`${edge.x},${edge.y} ${bend},${item.y} ${x},${item.y}`} fill="none" stroke={item.color} strokeWidth="1.25" />
                <text x={x} y={item.y - 6} textAnchor={item.right ? "start" : "end"} fontSize="12" fill="currentColor">
                  <tspan fontWeight="650">{item.slice.name === "Lainnya" ? "Lainnya" : item.slice.name}</tspan>
                  <tspan fill="oklch(0.38 0.012 255)"> {shown}</tspan>
                </text>
                <text x={x} y={item.y + 10} textAnchor={item.right ? "start" : "end"} fontSize="11" fill="oklch(0.42 0.012 255)">
                  {formatMn(item.slice.valueMn)} juta USD · {formatPct(item.slice.sharePct)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Komposisi sebagai dua pie (ekspor nila, impor soga) dengan label kode, uraian, nilai, dan persen. */
export function CompositionStacks({ level, basisNote, exportSlices, importSlices }: { level: number | null; basisNote: string; exportSlices: Slice[]; importSlices: Slice[] }) {
  return (
    <Panel title={`Komposisi per kode HS${level ? `${level}` : ""}`} sub={<>Delapan kode terbesar dan sisanya. Label pada pie memuat kode HS, uraian, nilai juta USD, dan persentase. {basisNote}</>}>
      <div className="grid gap-8">
        <CompositionPie flow="export" slices={exportSlices} />
        <CompositionPie flow="import" slices={importSlices} />
      </div>
    </Panel>
  );
}

/** Batang horizontal sederhana: label, trek, nilai. */
export function HBars({ rows, flow = "export", empty }: { rows: Array<{ key: string; label: ReactNode; value: number; display: string }>; flow?: Flow; empty: string }) {
  if (!rows.length) return <p className="text-sm text-ink/60">{empty}</p>;
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return (
    <div className="grid gap-2.5">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-x-3 gap-y-1 text-[13px] md:grid-cols-[minmax(0,200px)_minmax(0,1fr)_64px]">
          <span className="truncate text-ink/70">{row.label}</span>
          <div className="col-span-2 row-start-2 h-3.5 rounded-sm bg-paper md:col-span-1 md:row-start-auto">
            <div className={cn("h-full rounded-sm", row.value < 0 ? "bg-clay" : flow === "export" ? "bg-nila" : "bg-soga")} style={{ width: `${(Math.abs(row.value) / max) * 100}%` }} />
          </div>
          <em className="col-start-2 row-start-1 text-right font-semibold not-italic md:col-start-auto md:row-start-auto">{row.display}</em>
        </div>
      ))}
    </div>
  );
}

export function GrowthPanel({ rows, level, latest, base, className }: { rows: GrowthRow[]; level: number | null; latest: string | null; base: string | null; className?: string }) {
  return (
    <Panel
      className={className}
      title="Top 5 kenaikan ekspor YoY"
      sub={latest && base
        ? `${latest} dibanding ${base} (%), level HS${level ?? ""}. Tahun pembanding kosong atau di bawah 1 juta USD tidak dipakai.`
        : "Pertumbuhan dihitung untuk satu tahun tahunan terakhir terhadap tahun sebelumnya. Pilih tahun tahunan untuk melihatnya."}
    >
      <HBars
        empty="Tidak ada pasangan tahun pembanding pada level HS ini."
        rows={rows.map((row) => ({ key: row.code, label: <><b className="mr-1.5 font-semibold text-ink">{row.code}</b>{row.description}</>, value: Number(row.growthPct), display: formatPct(row.growthPct) }))}
      />
    </Panel>
  );
}

function CommodityTable({ title, sub, rows }: { title: string; sub: string; rows: CommodityRow[] }) {
  return (
    <Panel title={title} sub={sub}>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-ink/70">
                <th className="border-b border-ink/25 pb-2 pr-3 text-left">Kode</th>
                <th className="border-b border-ink/25 pb-2 pr-3 text-left">Komoditas</th>
                <th className="border-b border-ink/25 pb-2 pl-4 text-right shadow-[inset_0_-2px_0_oklch(var(--nila))]">Ekspor</th>
                <th className="border-b border-ink/25 pb-2 pl-4 text-right shadow-[inset_0_-2px_0_oklch(var(--soga))]">Impor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b border-line">
                  <td className="py-2.5 pr-3 align-top font-semibold">{row.code}</td>
                  <td className="py-2.5 pr-3 text-ink/70">{row.description}</td>
                  <td className="whitespace-nowrap py-2.5 pl-4 text-right align-top">{formatMn(row.exportMn)}</td>
                  <td className="whitespace-nowrap py-2.5 pl-4 text-right align-top">{formatMn(row.importMn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-ink/60">Belum ada peringkat pada level ini.</p>}
    </Panel>
  );
}

export function CommodityTables({ level, exportRows, importRows }: { level: number | null; exportRows: CommodityRow[]; importRows: CommodityRow[] }) {
  return (
    <div className="grid gap-x-7 xl:grid-cols-2">
      <CommodityTable title={`Top 10 ekspor${level ? ` HS${level}` : ""}`} sub="Diurutkan menurut ekspor, juta USD." rows={exportRows} />
      <CommodityTable title={`Top 10 impor${level ? ` HS${level}` : ""}`} sub="Diurutkan menurut impor, juta USD." rows={importRows} />
    </div>
  );
}

/** Label periode terpilih, mis. "2023 + 2024 + 2025". */
export function periodText(labels: string[]) {
  return labels.join(" + ");
}
