"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Input } from "@/components/ui";

type Overview = {
  paused: boolean;
  apiKeyConfigured: boolean;
  quotaUsed: number;
  quotaRemaining: number;
  quotaBudget: number;
  jobs: Record<string, number>;
  stages: Array<{ stage: string; status: string; count: number }>;
  failed: Array<{ id: string; stage: string; error: string | null; attempts: number }>;
  banner: { sourceKind: string; lastSyncedAt: string | null; hs8Status: string };
  exports: Array<{ id: string; status: string }>;
};

export function AdminPanel() {
  const [message, setMessage] = useState("");
  const [partner, setPartner] = useState("156");
  const [period, setPeriod] = useState("2024");
  const overview = useQuery({
    queryKey: ["sync-overview"],
    refetchInterval: 5000,
    queryFn: async () => {
      const response = await fetch("/api/admin/sync");
      if (!response.ok) throw new Error("Gagal memuat status.");
      return response.json() as Promise<Overview>;
    },
  });

  async function act(body: unknown) {
    setMessage("");
    const response = await fetch("/api/admin/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    setMessage(response.ok ? "Permintaan dicatat." : payload.error || "Gagal.");
    await overview.refetch();
  }

  const data = overview.data;
  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-4">
        <Card className="p-4"><p className="text-sm">Kunci API</p><p className="font-display text-lg font-semibold">{data?.apiKeyConfigured ? "Tersimpan" : "Kosong"}</p></Card>
        <Card className="p-4"><p className="text-sm">Kuota terpakai / sisa</p><p className="font-display text-lg font-semibold">{data ? `${data.quotaUsed} / ${data.quotaRemaining}` : "—"}</p></Card>
        <Card className="p-4"><p className="text-sm">Anggaran</p><p className="font-display text-lg font-semibold">{data?.quotaBudget ?? "—"}</p></Card>
        <Card className="p-4"><p className="text-sm">Sumber</p><Badge className="mt-2" tone={data?.banner.sourceKind === "UN_COMTRADE" ? "good" : "warn"}>{data?.banner.sourceKind ?? "…"}</Badge></Card>
      </section>
      <Card className="flex flex-wrap gap-2 p-4">
        <Button type="button" onClick={() => act({ action: "start-backfill" })}>Mulai backfill</Button>
        <Button type="button" variant="secondary" onClick={() => act({ action: "load-fixture" })}>Muat data contoh</Button>
        <Button type="button" variant="secondary" onClick={() => act({ action: data?.paused ? "resume" : "pause" })}>{data?.paused ? "Lanjutkan" : "Jeda"}</Button>
        <Button type="button" variant="secondary" onClick={() => act({ action: "retry-failed" })}>Ulangi gagal</Button>
        <Button type="button" variant="secondary" onClick={() => act({ action: "retry-incomplete" })}>Ulangi partisi belum lengkap</Button>
      </Card>
      <Card className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr_auto]">
        <Input value={partner} onChange={(event) => setPartner(event.target.value)} />
        <Button type="button" variant="secondary" onClick={() => act({ action: "refresh-country", partnerCode: partner })}>Segarkan negara</Button>
        <Input value={period} onChange={(event) => setPeriod(event.target.value)} />
        <Button type="button" variant="secondary" onClick={() => act({ action: "refresh-period", periodCode: period })}>Segarkan periode</Button>
      </Card>
      {message ? <p className="text-sm">{message}</p> : null}
      <Card className="p-4 text-sm">
        <h2 className="font-display text-lg font-semibold">Pekerjaan</h2>
        <p className="mt-2">{data ? Object.entries(data.jobs).map(([status, count]) => `${status}: ${count}`).join(" · ") : "Memuat…"}</p>
        <ul className="mt-3 space-y-1">
          {data?.stages.map((stage) => <li key={`${stage.stage}-${stage.status}`}>{stage.stage} / {stage.status}: {stage.count}</li>)}
        </ul>
        <h2 className="mt-4 font-display text-lg font-semibold">Gagal</h2>
        <ul className="mt-2 space-y-1">
          {data?.failed.map((job) => <li key={job.id}>{job.stage}: {job.error}</li>)}
        </ul>
        <p className="mt-3">HS8 {data?.banner.hs8Status}. Terakhir sukses: {data?.banner.lastSyncedAt ?? "belum ada"}.</p>
      </Card>
    </div>
  );
}
