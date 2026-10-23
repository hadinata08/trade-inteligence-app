import Link from "next/link";
import { getDashboard, togglePeriod } from "@iti/analytics";
import { AnnualTrend, PerformanceCombo } from "@/components/charts";
import { SubmitOnChangeSelect } from "@/components/submit-on-change";
import {
  Chip,
  CommodityTables,
  CompositionStacks,
  DataStatus,
  FlowLegend,
  GrowthPanel,
  HBars,
  KpiBand,
  PageHead,
  Panel,
  RailField,
  RailLayout,
  Segmented,
  periodText,
} from "@/components/trade-sections";
import { Card } from "@/components/ui";
import { formatMn, formatMnWhole, formatPct } from "@/lib/utils";

type Search = { periods?: string | string[]; period?: string; hs?: string; country?: string };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const data = await safe(() => getDashboard({ periods: params.periods ?? params.period, hs: params.hs, country: params.country }));
  if (!data.ok) return <ErrorState message={data.message} />;
  const dashboard = data.value;
  const number = (value: string | null) => (value == null ? null : Number(value));
  const labelOf = (code: string) => dashboard.periods.find((period) => period.code === code)?.label ?? code;
  const annual = dashboard.periods.filter((period) => /^\d{4}$/.test(period.code));
  const otherPeriods = dashboard.periods.filter((period) => !/^\d{4}$/.test(period.code));
  const state = { periods: dashboard.selected, hs: dashboard.hsLevel, country: dashboard.country };
  const selectedText = periodText(dashboard.selected.map(labelOf));
  const years = dashboard.annual.map((row) => row.period);
  const yearRange = years.length ? `${years[0]}–${years.at(-1)}` : "";
  const isWorld = dashboard.country === "0";
  const balanceLabel = dashboard.headline.balanceMn == null ? "Surplus / defisit neraca" : Number(dashboard.headline.balanceMn) >= 0 ? "Surplus neraca" : "Defisit neraca";
  const basisNote = dashboard.commodityBasis === "world"
    ? "Agregat resmi World pada level HS ini."
    : dashboard.commodityBasis === "bilateral"
      ? "Dihitung dari jumlah bilateral seluruh mitra (bisa sedikit berbeda dari agregat World)."
      : dashboard.commodityBasis === "partner"
        ? `Perdagangan Indonesia dengan ${dashboard.countryName}.`
        : "Komoditas belum tersedia untuk periode ini.";
  const points = dashboard.annual.map((row) => ({ label: row.period, exportMn: number(row.exportMn), importMn: number(row.importMn), balanceMn: number(row.balanceMn) }));
  const growthBase = dashboard.latestPeriod && dashboard.growthBasePeriod ? `${dashboard.latestPeriod} vs ${dashboard.growthBasePeriod}` : "pilih tahun tahunan";

  const rail = (
    <>
      <form action="/" className="grid gap-2">
        <label htmlFor="country" className="text-xs font-semibold text-ink/70">Negara</label>
        <input type="hidden" name="periods" value={dashboard.selected.join(",")} />
        <input type="hidden" name="hs" value={dashboard.hsLevel} />
        <SubmitOnChangeSelect id="country" name="country" defaultValue={dashboard.country} className="w-full border-ink/25">
          <option value="0">World (agregat resmi)</option>
          {dashboard.partners.map((partner) => <option key={partner.code} value={partner.code}>{partner.name}</option>)}
        </SubmitOnChangeSelect>
        <noscript><button className="min-h-10 rounded-md bg-ink px-3 text-sm text-white">Terapkan</button></noscript>
      </form>
      <RailField label="Tahun (pilih satu atau lebih)">
        <div className="grid grid-cols-3 gap-1.5">
          {annual.map((period) => (
            <Chip key={period.code} href={href({ ...state, periods: togglePeriod(dashboard.selected, period.code) })} active={dashboard.selected.includes(period.code)}>{period.label}</Chip>
          ))}
        </div>
        <Link href={href({ ...state, periods: annual.map((period) => period.code) })} scroll={false} className="text-sm text-nila underline underline-offset-4">Pilih semua tahun</Link>
      </RailField>
      {otherPeriods.length ? (
        <RailField label="Bulanan 2026">
          <div className="grid grid-cols-3 gap-1.5">
            {otherPeriods.map((period) => (
              <Chip key={period.code} href={href({ ...state, periods: togglePeriod(dashboard.selected, period.code) })} active={dashboard.selected.includes(period.code)}>
                {period.label.replace("2026-", "").replace("2026 Jan–Agt (kumulatif)", "Jan–Agt")}
              </Chip>
            ))}
          </div>
        </RailField>
      ) : null}
      <RailField label="Level HS">
        <Segmented items={([2, 4, 6] as const).map((level) => ({ href: href({ ...state, hs: level }), label: `HS${level}`, active: dashboard.hsLevel === level }))} />
      </RailField>
      <Link href="/" className="text-sm text-ink/70 underline underline-offset-4 hover:text-ink">Reset filter</Link>
      <DataStatus sourceKind={dashboard.banner.sourceKind} lastSyncedAt={dashboard.banner.lastSyncedAt} notes={dashboard.banner.notes} />
    </>
  );

  return (
    <RailLayout rail={rail}>
      <PageHead
        title={`${dashboard.countryName}, ${selectedText}`}
        note={isWorld ? "Total dari agregat resmi World; komoditas dari jumlah bilateral seluruh mitra." : `Perdagangan Indonesia dengan ${dashboard.countryName}.`}
      >
        <FlowLegend />
      </PageHead>
      {dashboard.banner.sourceKind !== "UN_COMTRADE" ? (
        <p className="mt-4 rounded-md border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
          {dashboard.banner.sourceKind === "FIXTURE" ? "Basis data memuat DATA CONTOH. Angka di halaman ini bukan statistik resmi UN Comtrade." : "Belum ada data tersimpan."}
        </p>
      ) : null}
      <KpiBand
        items={[
          { label: `Total ekspor ${selectedText}`, value: formatMn(dashboard.headline.exportMn), unit: "juta USD", note: isWorld ? "Agregat World" : dashboard.countryName, flow: "export" },
          { label: `Total impor ${selectedText}`, value: formatMn(dashboard.headline.importMn), unit: "juta USD", note: isWorld ? "Agregat World" : dashboard.countryName, flow: "import" },
          { label: balanceLabel, value: formatMn(dashboard.headline.balanceMn), unit: "juta USD", note: "ekspor − impor" },
          { label: "Pertumbuhan ekspor", value: formatPct(dashboard.headline.growthExportPct), note: `${growthBase}; impor ${formatPct(dashboard.headline.growthImportPct)}${isWorld ? `, ${dashboard.headline.partnerCount} mitra` : ""}` },
        ]}
      />
      <div className="grid gap-x-7 xl:grid-cols-12">
        <Panel className="xl:col-span-8" title="Kinerja perdagangan tahunan" sub={`Ekspor dan impor ${yearRange}, juta USD; garis menunjukkan neraca.`}>
          <PerformanceCombo points={points} />
        </Panel>
        <Panel className="xl:col-span-4" title="Neraca per tahun" sub="Ekspor dikurangi impor, juta USD.">
          <BalanceTable rows={dashboard.annual} />
        </Panel>
      </div>
      <Panel title="Tren tahunan" sub={`Arah ekspor dan impor ${dashboard.countryName}, ${yearRange} (rentang sama dengan grafik kinerja), juta USD.`}>
        <AnnualTrend points={points} />
      </Panel>
      <CompositionStacks level={dashboard.commodityLevel} basisNote={basisNote} exportSlices={dashboard.compositionExport} importSlices={dashboard.compositionImport} />
      <div className="grid gap-x-7 xl:grid-cols-2">
        <GrowthPanel rows={dashboard.growthCommodities} level={dashboard.commodityLevel} latest={dashboard.latestPeriod} base={dashboard.growthBasePeriod} />
        {isWorld ? (
          <Panel title="Mitra tujuan ekspor terbesar" sub={`Sepuluh mitra, ${selectedText}, juta USD.`}>
            <HBars empty="Tidak ada data mitra." rows={dashboard.topExport.map((row) => ({ key: row.code, label: row.name, value: Number(row.valueMn), display: formatMnWhole(row.valueMn) }))} />
          </Panel>
        ) : (
          <Panel title="Peringkat mitra" sub="Peringkat mitra hanya untuk World.">
            <Link className="text-sm text-nila underline underline-offset-4" href={`/countries/${dashboard.country}`}>Buka halaman {dashboard.countryName}</Link>
          </Panel>
        )}
      </div>
      {isWorld ? (
        <Panel title="Mitra asal impor terbesar" sub={`Sepuluh mitra, ${selectedText}, juta USD.`}>
          <HBars flow="import" empty="Tidak ada data mitra." rows={dashboard.topImport.map((row) => ({ key: row.code, label: row.name, value: Number(row.valueMn), display: formatMnWhole(row.valueMn) }))} />
        </Panel>
      ) : null}
      <CommodityTables level={dashboard.commodityLevel} exportRows={dashboard.topExportCommodities} importRows={dashboard.topImportCommodities} />
      <p className="pt-6 text-sm text-ink/60">Angka kosong (n.a.) berarti observasi tidak tersedia, bukan nol. <Link className="text-nila underline underline-offset-4" href="/reports/generate">Buat workbook Excel</Link></p>
    </RailLayout>
  );
}

function BalanceTable({ rows }: { rows: Array<{ period: string; balanceMn: string | null }> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs font-semibold text-ink/70">
          <th className="border-b border-ink/25 pb-2 text-left">Tahun</th>
          <th className="border-b border-ink/25 pb-2 text-right">Neraca</th>
          <th className="border-b border-ink/25 pb-2 text-right">Perubahan</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const previous = index > 0 ? rows[index - 1]?.balanceMn ?? null : null;
          const delta = row.balanceMn != null && previous != null ? Number(row.balanceMn) - Number(previous) : null;
          return (
            <tr key={row.period} className="border-b border-line">
              <td className="py-2.5">{row.period}</td>
              <td className="py-2.5 text-right">{formatMn(row.balanceMn)}</td>
              <td className="py-2.5 text-right text-ink/70">{delta == null ? "—" : `${delta > 0 ? "+" : ""}${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(delta)}`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function href(state: { periods: string[]; hs: number; country: string }) {
  const query = new URLSearchParams({ periods: state.periods.join(","), hs: String(state.hs) });
  if (state.country !== "0") query.set("country", state.country);
  return `/?${query.toString()}`;
}

function ErrorState({ message }: { message: string }) {
  return <Card className="p-6"><h1 className="font-display text-2xl font-semibold">Basis data belum siap</h1><p className="mt-3 text-sm">{message}</p></Card>;
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Gagal membaca PostgreSQL." };
  }
}
