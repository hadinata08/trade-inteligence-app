import { compareCountries, listPeriodOptions } from "@iti/analytics";
import { FlowLegend, HBars, PageHead, Panel } from "@/components/trade-sections";
import { Input } from "@/components/ui";
import { formatMn, formatMnWhole } from "@/lib/utils";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ codes?: string; period?: string }> }) {
  const params = await searchParams;
  const codes = (params.codes || "156,392,842").split(",").map((code) => code.trim()).filter(Boolean).slice(0, 6);
  const periods = await listPeriodOptions().catch(() => []);
  const period = params.period || periods.find((item) => item.kind === "ANNUAL")?.code || "2024";
  const rows = await compareCountries(codes, period).catch(() => []);
  const bars = (flow: "export" | "import") =>
    rows
      .filter((row) => (flow === "export" ? row.exportMn : row.importMn) != null)
      .map((row) => {
        const value = Number(flow === "export" ? row.exportMn : row.importMn);
        return { key: row.code, label: row.name, value, display: formatMnWhole(value) };
      });
  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHead title="Perbandingan negara" note={`Ekspor, impor, dan neraca beberapa mitra pada ${period}, juta USD.`}>
        <FlowLegend />
      </PageHead>
      <form className="grid gap-3 border-b border-line py-5 md:grid-cols-[1fr_160px_auto]" action="/compare">
        <label className="grid gap-1.5 text-xs font-semibold text-ink/70">Kode M49 mitra, pisahkan koma (maks. 6)
          <Input name="codes" defaultValue={codes.join(",")} placeholder="156,392,842" />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-ink/70">Periode
          <select name="period" defaultValue={period} className="h-10 rounded-md border border-ink/25 bg-card px-3 text-sm font-normal">
            {periods.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <button className="h-10 self-end rounded-md bg-ink px-4 text-sm font-medium text-white">Bandingkan</button>
      </form>
      <div className="grid gap-x-7 xl:grid-cols-2">
        <Panel title="Ekspor" sub="Juta USD."><HBars empty="Tidak ada data ekspor." rows={bars("export")} /></Panel>
        <Panel title="Impor" sub="Juta USD."><HBars flow="import" empty="Tidak ada data impor." rows={bars("import")} /></Panel>
      </div>
      <Panel title="Rincian" sub="Neraca = ekspor dikurangi impor. n.a. berarti observasi tidak tersedia.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-ink/70">
                <th className="border-b border-ink/25 pb-2 text-left">Negara</th>
                <th className="border-b border-ink/25 pb-2 pl-4 text-right shadow-[inset_0_-2px_0_oklch(var(--nila))]">Ekspor</th>
                <th className="border-b border-ink/25 pb-2 pl-4 text-right shadow-[inset_0_-2px_0_oklch(var(--soga))]">Impor</th>
                <th className="border-b border-ink/25 pb-2 pl-4 text-right">Neraca</th>
                <th className="border-b border-ink/25 pb-2 pl-4 text-left">Kelengkapan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b border-line">
                  <td className="py-2.5">{row.name}</td>
                  <td className="py-2.5 pl-4 text-right">{formatMn(row.exportMn)}</td>
                  <td className="py-2.5 pl-4 text-right">{formatMn(row.importMn)}</td>
                  <td className="py-2.5 pl-4 text-right">{formatMn(row.balanceMn)}</td>
                  <td className="py-2.5 pl-4 text-ink/70">{row.completeness}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
