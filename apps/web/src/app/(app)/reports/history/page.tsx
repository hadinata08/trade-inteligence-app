import { listExports } from "@iti/analytics";
import { Badge, Card } from "@/components/ui";

export default async function HistoryPage() {
  const rows = await listExports().catch(() => []);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-semibold tracking-tight">Riwayat ekspor</h1>
      <Card className="overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="py-2">Waktu</th><th>Status</th><th>Berkas</th><th></th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="py-2">{new Date(row.createdAt).toLocaleString("id-ID")}</td>
                <td><Badge tone={row.status === "COMPLETED" ? "good" : row.status === "FAILED" ? "bad" : "warn"}>{row.status}</Badge></td>
                <td>{row.fileName ?? "—"}</td>
                <td>{row.status === "COMPLETED" ? <a className="underline" href={`/api/reports/${row.id}/download`}>Unduh</a> : row.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="py-6 text-sm text-ink/60">Belum ada ekspor.</p> : null}
      </Card>
    </div>
  );
}
