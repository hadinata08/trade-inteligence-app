import Link from "next/link";
import { listCountries, listPeriodOptions } from "@iti/analytics";
import { CountriesTable } from "@/components/countries-table";
import { Card, Input } from "@/components/ui";

export default async function CountriesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; period?: string }> }) {
  const params = await searchParams;
  const page = Number(params.page || 1);
  let rows: Awaited<ReturnType<typeof listCountries>> | null = null;
  let periods: Awaited<ReturnType<typeof listPeriodOptions>> = [];
  let error = "";
  try {
    periods = await listPeriodOptions();
    rows = await listCountries({ q: params.q, page, period: params.period });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Gagal memuat negara.";
  }
  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-semibold tracking-tight">Negara mitra</h1>
      <form className="grid gap-3 md:grid-cols-[1fr_180px_auto]" action="/countries">
        <Input name="q" defaultValue={params.q} placeholder="Cari nama, kode M49, atau ISO" />
        <select name="period" defaultValue={params.period || rows?.period} className="h-10 rounded-md border border-line bg-white px-3">
          {periods.map((period) => <option key={period.code} value={period.code}>{period.label}</option>)}
        </select>
        <button className="rounded-md bg-pine px-4 text-sm text-white">Cari</button>
      </form>
      <Card className="p-4">
        {error ? <p>{error}</p> : rows ? <CountriesTable rows={rows.rows} /> : null}
      </Card>
      {rows ? (
        <div className="flex items-center justify-between text-sm">
          <p>{rows.total} mitra · halaman {rows.page}</p>
          <div className="flex gap-3">
            {rows.page > 1 ? <Link href={`/countries?page=${rows.page - 1}&q=${params.q || ""}&period=${rows.period}`}>Sebelumnya</Link> : null}
            {rows.page * rows.pageSize < rows.total ? <Link href={`/countries?page=${rows.page + 1}&q=${params.q || ""}&period=${rows.period}`}>Berikutnya</Link> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
