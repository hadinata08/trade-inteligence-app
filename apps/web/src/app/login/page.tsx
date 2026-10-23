import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {/* Dua garis warna aliran (nila ekspor, soga impor) sebagai tanda sistem. */}
      <div className="mb-5 flex h-1.5 w-24 overflow-hidden rounded-sm" aria-hidden="true"><span className="flex-[1.16] bg-nila" /><span className="flex-1 bg-soga" /></div>
      <p className="flex items-center gap-2.5">
        <span className="font-display text-xl font-bold tracking-tight">ITI</span>
        <span className="leading-tight">
          <span className="block text-xs text-ink/70">Perdagangan barang Indonesia</span>
          <span className="block text-[11px] text-ink/45">by Yunita Dwi Ayu Ningtias</span>
        </span>
      </p>
      <p className="mt-4 font-display text-[28px] font-semibold tracking-tight">Indonesia Trade Intelligence</p>
      <p className="mt-3 text-sm text-ink/70">Masuk untuk membaca data tersimpan dan membuat workbook Excel. Kunci UN Comtrade tidak pernah dikirim ke peramban.</p>
      <LoginForm nextPath={params.next || "/"} error={params.error} />
    </div>
  );
}
