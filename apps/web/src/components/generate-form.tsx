"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataStatus, PageHead, Panel, RailField } from "@/components/trade-sections";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

type Period = { code: string; label: string; kind: string };
type Banner = { sourceKind: string; lastSyncedAt: string | null; notes: string | null };
type ExportStatus = {
  status: string;
  progress: { stage?: string; warnings?: string[]; countriesCompleted?: number; countriesTotal?: number };
  error?: string;
  fileName?: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  QUEUED: "Dalam antrean",
  RUNNING: "Sedang dibuat",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
};

const LEVELS = [
  { value: 0, label: "TOTAL" },
  { value: 2, label: "HS2" },
  { value: 4, label: "HS4" },
  { value: 6, label: "HS6" },
  { value: 8, label: "HS8" },
] as const;

export function GenerateForm({ periods, banner }: { periods: Period[]; banner: Banner | null }) {
  const [exportId, setExportId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ["export", exportId],
    enabled: Boolean(exportId),
    refetchInterval: (query) => (query.state.data?.status === "COMPLETED" || query.state.data?.status === "FAILED" ? false : 2000),
    queryFn: async () => {
      const response = await fetch(`/api/reports/${exportId}`);
      if (!response.ok) throw new Error("Status ekspor tidak dapat dibaca.");
      return response.json() as Promise<ExportStatus>;
    },
  });
  const exportActive = status.data?.status === "QUEUED" || status.data?.status === "RUNNING" || status.data?.status === "PENDING";

  const annual = periods.filter((period) => period.kind === "ANNUAL" && /^\d{4}$/.test(period.code));
  const monthly = periods.filter((period) => /^\d{6}$/.test(period.code));
  const cumulative = periods.find((period) => period.code === "2026M01-08");

  return (
    <form
      className="-mx-4 -my-6 grid min-h-[calc(100vh-3.5rem)] sm:-mx-6 lg:grid-cols-[264px_minmax(0,1fr)]"
      onReset={() => {
        setError("");
        setExportId(null);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setBusy(true);
        const form = new FormData(event.currentTarget);
        const preset = form.get("preset") === "full";
        const levels = form.getAll("levels").map(Number);
        const partnerCodes = String(form.get("partners") || "").split(",").map((code) => code.trim()).filter(Boolean);
        try {
          const response = await fetch("/api/reports", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              preset: preset ? "full" : "custom",
              allPartners: preset || form.get("allPartners") === "on" || partnerCodes.length === 0,
              partnerCodes,
              periods: form.getAll("periods"),
              hsLevels: levels,
              includeHs8: levels.includes(8) || preset,
              includeCharts: form.get("charts") === "on" || preset,
              includeDetail: form.get("detail") === "on" || preset,
              includeCoverage: true,
            }),
          });
          const body = await response.json();
          if (!response.ok) {
            setError(body.error || "Gagal membuat antrean.");
            return;
          }
          setExportId(body.exportId);
        } catch {
          setError("Gagal menghubungi antrean ekspor.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <aside className="flex flex-col gap-6 border-b border-line bg-card px-4 py-5 sm:px-6 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-5" aria-label="Cakupan workbook">
        <RailField label="Mitra">
          <Input name="partners" placeholder="156, 392, 842" className="border-ink/25" />
          <p className="text-xs leading-relaxed text-ink/55">Kode M49, pisahkan koma. Kosongkan bila semua negara dipilih.</p>
          <Toggle name="allPartners">Semua negara</Toggle>
        </RailField>
        <RailField label="Tingkat HS">
          <div className="grid grid-cols-3 gap-1.5">
            {LEVELS.map((level) => (
              <Toggle key={level.value} name="levels" value={String(level.value)} defaultChecked={level.value !== 8}>{level.label}</Toggle>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-ink/55">HS8 hanya diisi bila sumber resmi menyediakan tarif line.</p>
        </RailField>
        <RailField label="Isi workbook">
          <div className="grid gap-1.5">
            <Toggle name="charts" defaultChecked>Grafik dasbor</Toggle>
            <Toggle name="detail" defaultChecked>Baris komoditas</Toggle>
          </div>
          <p className="text-xs leading-relaxed text-ink/55">Laporan lengkap mengabaikan filter ini dan memakai seluruh cakupan.</p>
        </RailField>
        {banner ? <DataStatus sourceKind={banner.sourceKind} lastSyncedAt={banner.lastSyncedAt} notes={banner.notes} /> : null}
      </aside>
      <div className="min-w-0 px-4 pb-12 pt-6 sm:px-8 lg:px-9">
        <div className="mx-auto max-w-[1240px]">
          <PageHead title="Buat Excel" note="Workbook disusun di antrean latar, lalu dapat diunduh dari halaman ini." />
          <Panel title="Periode" sub="Centang tahun dan bulan yang masuk ke workbook. Bawaan: semua periode yang tersedia.">
            {periods.length ? (
              <div className="grid gap-5">
                {annual.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-ink/70">Tahunan</p>
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                      {annual.map((period) => (
                        <Toggle key={period.code} name="periods" value={period.code} defaultChecked>{period.label}</Toggle>
                      ))}
                    </div>
                  </div>
                ) : null}
                {monthly.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-ink/70">Bulanan 2026</p>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                      {monthly.map((period) => (
                        <Toggle key={period.code} name="periods" value={period.code} defaultChecked>{monthLabel(period.code)}</Toggle>
                      ))}
                    </div>
                  </div>
                ) : null}
                {cumulative ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-ink/70">Kumulatif</p>
                    <div className="max-w-[10rem]">
                      <Toggle name="periods" value={cumulative.code} defaultChecked>Jan–Agt</Toggle>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink/60">Belum ada periode tersimpan.</p>
            )}
          </Panel>
          <div className="flex flex-wrap items-center gap-2 border-b border-line py-5">
            <Button type="submit" name="preset" value="full" disabled={busy || exportActive}>Laporan lengkap</Button>
            <Button type="submit" variant="secondary" disabled={busy || exportActive}>Generate Excel</Button>
            <Button type="reset" variant="ghost">Reset filter</Button>
          </div>
          {error ? <p className="mt-5 rounded-md border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p> : null}
          {status.data ? <ExportProgress data={status.data} exportId={exportId} /> : null}
          {status.error ? <p className="mt-5 text-sm text-clay">Status ekspor tidak dapat dibaca.</p> : null}
        </div>
      </div>
    </form>
  );
}

function ExportProgress({ data, exportId }: { data: ExportStatus; exportId: string | null }) {
  const done = data.progress?.countriesCompleted ?? 0;
  const total = data.progress?.countriesTotal ?? 0;
  const width = total > 0 ? Math.min(100, (done / total) * 100) : data.status === "COMPLETED" ? 100 : 8;
  return (
    <section className="border-b border-line py-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Antrean</h2>
        <p className={cn("text-sm font-semibold", data.status === "FAILED" ? "text-clay" : data.status === "COMPLETED" ? "text-moss" : "text-ink/70")}>
          {STATUS_LABEL[data.status] ?? data.status}
        </p>
      </div>
      <p className="mt-1 text-[13px] text-ink/70">{data.progress?.stage || "Menunggu pekerja ekspor."}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-sm bg-paper" role="progressbar" aria-valuenow={Math.round(width)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full", data.status === "FAILED" ? "bg-clay" : "bg-ink")} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-2 text-[13px] text-ink/55">Negara {done} / {total || "—"}</p>
      {data.progress?.warnings?.length ? (
        <ul className="mt-3 grid gap-1 text-sm text-ink/70">
          {data.progress.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      {data.error ? <p className="mt-3 text-sm text-clay">{data.error}</p> : null}
      {data.status === "COMPLETED" && exportId ? (
        <a className="mt-4 inline-block text-sm font-semibold text-nila underline underline-offset-4" href={`/api/reports/${exportId}/download`}>
          Unduh {data.fileName || "Excel"}
        </a>
      ) : null}
    </section>
  );
}

function Toggle({ name, value, defaultChecked, children }: { name: string; value?: string; defaultChecked?: boolean; children: ReactNode }) {
  return (
    <label>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-ink/20 bg-card px-2 text-center text-sm font-medium text-ink/75 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-nila">
        {children}
      </span>
    </label>
  );
}

function monthLabel(code: string) {
  const month = Number(code.slice(4, 6));
  return MONTHS[month - 1] ?? code;
}
