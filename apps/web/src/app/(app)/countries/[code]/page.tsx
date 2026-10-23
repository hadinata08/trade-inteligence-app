import Link from "next/link";
import { notFound } from "next/navigation";
import { getCountry, getDatasetBanner, getTradeView, listHsOptions, listPartnerOptions, listPeriodOptions, parseHsLevel, parsePeriods, togglePeriod } from "@iti/analytics";
import { AnnualTrend } from "@/components/charts";
import { CommodityTree } from "@/components/commodity-tree";
import { CountryNavigateSelect } from "@/components/submit-on-change";
import {
  Chip,
  CommodityTables,
  CompositionStacks,
  DataStatus,
  FlowLegend,
  GrowthPanel,
  KpiBand,
  PageHead,
  Panel,
  RailField,
  RailLayout,
  Segmented,
  periodText,
} from "@/components/trade-sections";
import { Badge } from "@/components/ui";
import { formatMn, formatPct } from "@/lib/utils";

type Search = { periods?: string | string[]; period?: string; level?: string; hs?: string };

export default async function CountryPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Search> }) {
  const { code } = await params;
  const query = await searchParams;
  const periods = await listPeriodOptions().catch(() => []);
  const annualOptions = periods.filter((period) => /^\d{4}$/.test(period.code));
  const selected = parsePeriods(query.periods ?? query.period, annualOptions.map((period) => period.code), annualOptions.at(-1)?.code);
  const latest = selected.at(-1);
  const country = await getCountry(code, latest).catch(() => null);
  if (!country) notFound();
  const hsLevel = parseHsLevel(query.level);
  const hsCode = query.hs && /^\d{2,6}$/.test(query.hs.trim()) ? query.hs.trim() : null;
  const [view, partners, hsOptions, banner] = await Promise.all([
    getTradeView({ partnerCode: code, periods: selected, hsLevel, hsCode }),
    listPartnerOptions().catch(() => []),
    listHsOptions().catch(() => []),
    getDatasetBanner().catch(() => null),
  ]);
  const hsName = hsCode ? hsOptions.find((option) => option.code === hsCode)?.description ?? "" : "";
  const state = { periods: selected, level: hsLevel, hs: hsCode };
  const selectedText = periodText(selected);
  const subject = hsCode ? `HS ${hsCode}${hsName ? ` (${hsName})` : ""}` : "seluruh komoditas";
  const number = (value: string | null) => (value == null ? null : Number(value));
  const points = view.annual.map((row) => ({ label: row.period, exportMn: number(row.exportMn), importMn: number(row.importMn), balanceMn: number(row.balanceMn) }));
  const balanceLabel = view.headline.balanceMn == null ? "Surplus / defisit neraca" : Number(view.headline.balanceMn) >= 0 ? "Surplus neraca" : "Defisit neraca";
  const countryOptions = partners.some((partner) => partner.code === country.partner.code) ? partners : [{ code: country.partner.code, name: country.partner.name }, ...partners];

  const rail = (
    <>
      <RailField label="Negara mitra">
        <CountryNavigateSelect value={country.partner.code} query={toQuery(state)} options={countryOptions} />
      </RailField>
      <RailField label="Tahun (pilih satu atau lebih)">
        <div className="grid grid-cols-3 gap-1.5">
          {annualOptions.map((period) => (
            <Chip key={period.code} href={href(code, { ...state, periods: togglePeriod(selected, period.code) })} active={selected.includes(period.code)}>{period.label}</Chip>
          ))}
        </div>
        <Link href={href(code, { ...state, periods: annualOptions.map((period) => period.code) })} scroll={false} className="text-sm text-nila underline underline-offset-4">Pilih semua tahun</Link>
      </RailField>
      <RailField label="Level HS">
        <Segmented items={([2, 4, 6] as const).map((level) => ({ href: href(code, { ...state, level }), label: `HS${level}`, active: hsLevel === level }))} />
      </RailField>
      <form action={`/countries/${code}`} className="grid gap-2">
        <label htmlFor="hs" className="text-xs font-semibold text-ink/70">Kode HS</label>
        <input type="hidden" name="periods" value={selected.join(",")} />
        <input type="hidden" name="level" value={hsLevel} />
        <input id="hs" name="hs" list="hs-options" defaultValue={hsCode ?? ""} placeholder="mis. 27 atau 1511" inputMode="numeric" pattern="\d{2,6}" className="h-10 w-full rounded-md border border-ink/25 bg-card px-3 text-sm" />
        <button className="h-10 w-full rounded-md bg-ink px-3 text-sm font-medium text-white">Terapkan kode HS</button>
        <datalist id="hs-options">
          {hsOptions.map((option) => <option key={option.code} value={option.code}>{option.description}</option>)}
        </datalist>
        {hsCode ? <Link className="text-sm text-nila underline underline-offset-4" href={href(code, { ...state, hs: null })}>Hapus kode HS</Link> : <p className="text-xs text-ink/55">Kosongkan untuk seluruh komoditas.</p>}
      </form>
      <Link href={`/countries/${code}`} className="text-sm text-ink/70 underline underline-offset-4 hover:text-ink">Reset filter</Link>
      <DataStatus sourceKind={banner?.sourceKind ?? "EMPTY"} lastSyncedAt={banner?.lastSyncedAt ?? null} notes={banner?.notes} />
    </>
  );

  return (
    <RailLayout rail={rail}>
      <PageHead
        title={`${country.partner.name}, ${selectedText}`}
        note={<>Perdagangan Indonesia dengan {country.partner.name}, {subject}. M49 {country.partner.code}, ISO {country.partner.iso3 ?? "tidak ada"}.</>}
      >
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex gap-2"><Badge>{country.partner.entityType}</Badge><Badge tone={country.cumulative.status === "COMPLETE" ? "good" : "warn"}>Kumulatif 2026 {country.cumulative.status}</Badge></div>
          <FlowLegend />
        </div>
      </PageHead>
      <KpiBand
        items={[
          { label: `Ekspor ${selectedText}`, value: formatMn(view.headline.exportMn), unit: "juta USD", flow: "export" },
          { label: `Impor ${selectedText}`, value: formatMn(view.headline.importMn), unit: "juta USD", flow: "import" },
          { label: balanceLabel, value: formatMn(view.headline.balanceMn), unit: "juta USD", note: "ekspor − impor" },
          { label: "Pertumbuhan ekspor", value: formatPct(view.headline.growthExportPct), note: `${view.latestPeriod && view.growthBasePeriod ? `${view.latestPeriod} vs ${view.growthBasePeriod}` : "n.a."}; impor ${formatPct(view.headline.growthImportPct)}` },
        ]}
      />
      <div className="grid gap-x-7 xl:grid-cols-12">
        <Panel className="xl:col-span-7" title="Riwayat tahunan" sub={`Ekspor, impor, dan neraca (garis putus), ${subject}, juta USD.`}>
          <AnnualTrend points={points} showBalance />
        </Panel>
        <Panel className="xl:col-span-5" title="Nilai per tahun" sub="Juta USD; tahun terpilih ditebalkan. Nilai kecil terbaca di sini.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-ink/70">
                <th className="border-b border-ink/25 pb-2 text-left">Tahun</th>
                <th className="border-b border-ink/25 pb-2 pl-3 text-right shadow-[inset_0_-2px_0_oklch(var(--nila))]">Ekspor</th>
                <th className="border-b border-ink/25 pb-2 pl-3 text-right shadow-[inset_0_-2px_0_oklch(var(--soga))]">Impor</th>
                <th className="border-b border-ink/25 pb-2 pl-3 text-right">Neraca</th>
              </tr>
            </thead>
            <tbody>
              {view.annual.map((row) => (
                <tr key={row.period} className={selected.includes(row.period) ? "border-b border-line bg-paper font-semibold" : "border-b border-line"}>
                  <td className="py-2.5">{row.period}</td>
                  <td className="py-2.5 pl-3 text-right">{formatMn(row.exportMn)}</td>
                  <td className="py-2.5 pl-3 text-right">{formatMn(row.importMn)}</td>
                  <td className="py-2.5 pl-3 text-right">{formatMn(row.balanceMn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      {view.commodityLevel ? (
        <>
          <CompositionStacks level={view.commodityLevel} basisNote={`${country.partner.name}, ${selectedText}${hsCode ? `, turunan HS ${hsCode}` : ""}.`} exportSlices={view.compositionExport} importSlices={view.compositionImport} />
          <GrowthPanel rows={view.growthCommodities} level={view.commodityLevel} latest={view.latestPeriod} base={view.growthBasePeriod} />
          <CommodityTables level={view.commodityLevel} exportRows={view.topExportCommodities} importRows={view.topImportCommodities} />
        </>
      ) : (
        <Panel title="Komposisi" sub={`Kode HS ${hsCode} sudah di level terdalam yang dirinci; komposisi dan peringkat tidak tersedia.`}><span /></Panel>
      )}
      <Panel title={`Hierarki HS, ${country.selected}`} sub="Baris HS2 dimuat lebih dulu; HS4, HS6, dan HS8 diambil dari server saat baris dibuka.">
        <CommodityTree partnerCode={country.partner.code} periodCode={country.selected} chapters={country.chapters} />
      </Panel>
      <Panel title="Januari–Agustus 2026" sub="Kumulatif delapan bulan; bulan yang hilang tidak dihitung sebagai nol.">
        <p className="text-sm">Status {country.cumulative.status}. Ekspor {formatMn(country.cumulative.exportMn)} juta USD. Impor {formatMn(country.cumulative.importMn)} juta USD.</p>
        {country.cumulative.status === "PARTIAL" ? <p className="mt-2 text-sm text-ink/70">Bulan belum lengkap: {country.cumulative.monthsMissing.join(", ") || "—"}. Jumlah parsial yang diungkapkan terpisah: {formatMn(country.cumulative.disclosedPartialExportMn)} juta USD.</p> : null}
      </Panel>
    </RailLayout>
  );
}

type State = { periods: string[]; level: number; hs: string | null };

function toQuery(state: State) {
  const query = new URLSearchParams({ periods: state.periods.join(","), level: String(state.level) });
  if (state.hs) query.set("hs", state.hs);
  return query.toString();
}

function href(code: string, state: State) {
  return `/countries/${code}?${toQuery(state)}`;
}
