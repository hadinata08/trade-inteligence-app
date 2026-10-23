import { AdminPanel } from "@/components/admin-panel";

export default function AdminPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-semibold tracking-tight">Admin sinkronisasi</h1>
      <p className="max-w-3xl text-sm text-ink/70">Kuota dihitung pada jendela bergulir 24 jam UTC, bukan tengah malam WIB. Anggaran operasional bawaan 450 panggilan menyisakan jatah dari batas 500 panggilan Free API.</p>
      <AdminPanel />
    </div>
  );
}
