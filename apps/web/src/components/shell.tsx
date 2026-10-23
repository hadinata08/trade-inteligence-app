import { NavLinks } from "@/components/nav-links";

const links = [
  { href: "/", label: "Dasbor" },
  { href: "/countries", label: "Negara mitra" },
  { href: "/commodities", label: "Komoditas HS" },
  { href: "/compare", label: "Perbandingan" },
  { href: "/coverage", label: "Cakupan data" },
  { href: "/reports/generate", label: "Buat Excel" },
  { href: "/reports/history", label: "Riwayat ekspor" },
  { href: "/admin/synchronization", label: "Sinkronisasi" },
];

/**
 * Bilah atas tipis untuk navigasi; kolom kiri halaman dipakai untuk rel filter (Sistem Nila–Soga).
 */
export function Shell({ children, email }: { children: React.ReactNode; email: string }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-card">
        <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
          <p className="flex shrink-0 items-center gap-2.5">
            <span className="font-display text-xl font-bold tracking-tight">ITI</span>
            <span className="hidden leading-tight md:block">
              <span className="block text-xs text-ink/70">Perdagangan barang Indonesia</span>
              <span className="block text-[11px] text-ink/45">by Yunita Dwi Ayu Ningtias</span>
            </span>
          </p>
          <NavLinks links={links} />
          <form action="/api/auth/logout" method="post" className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-ink/55 xl:inline">{email}</span>
            <button className="min-h-10 rounded-md px-3 text-sm text-ink/70 hover:bg-paper hover:text-ink" type="submit">Keluar</button>
          </form>
        </div>
      </header>
      <main className="px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
