import { searchCommodities } from "@iti/analytics";
import { Card, Input } from "@/components/ui";

export default async function CommoditiesPage({ searchParams }: { searchParams: Promise<{ q?: string; level?: string; page?: string }> }) {
  const params = await searchParams;
  const level = params.level ? Number(params.level) : undefined;
  let result: Awaited<ReturnType<typeof searchCommodities>> | null = null;
  let error = "";
  try {
    result = await searchCommodities({ q: params.q, level, page: Number(params.page || 1) });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Gagal mencari komoditas.";
  }
  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-semibold tracking-tight">Komoditas HS</h1>
      <form className="grid gap-3 md:grid-cols-[1fr_140px_auto]" action="/commodities">
        <Input name="q" defaultValue={params.q} placeholder="Kode atau uraian" />
        <select name="level" defaultValue={params.level || ""} className="h-10 rounded-md border border-line bg-white px-3">
          <option value="">Semua tingkat</option>
          <option value="2">HS2</option>
          <option value="4">HS4</option>
          <option value="6">HS6</option>
          <option value="8">HS8</option>
        </select>
        <button className="rounded-md bg-pine px-4 text-sm text-white">Cari</button>
      </form>
      <Card className="overflow-x-auto p-4">
        {error ? <p>{error}</p> : null}
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="py-2">Kode</th><th>Tingkat</th><th>Induk</th><th>Uraian</th></tr></thead>
          <tbody>
            {result?.rows.map((row) => (
              <tr key={row.hsCode} className="border-b border-line/70">
                <td className="py-2 font-mono">{row.hsCode}</td>
                <td>HS{row.level}</td>
                <td className="font-mono">{row.parentCode ?? "—"}</td>
                <td>{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result?.rows.length && !error ? <p className="py-6 text-sm text-ink/60">Tidak ada komoditas. Jalankan sinkronisasi atau muat data contoh.</p> : null}
      </Card>
    </div>
  );
}
