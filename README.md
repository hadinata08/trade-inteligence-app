# Indonesia Trade Intelligence

Aplikasi analitik perdagangan barang internasional Indonesia. Data resmi diambil dari UN Comtrade Free API, disimpan di PostgreSQL, diproses lewat Redis dan BullMQ, lalu dibaca oleh situs Next.js dan workbook Microsoft Excel.

Workbook Excel adalah hasil utama. Dasbor web hanya membaca PostgreSQL dan tidak memanggil UN Comtrade saat filter berubah.

## Yang sudah ada

- Next.js App Router, TypeScript ketat, Tailwind, TanStack Query, TanStack Table, dan Recharts.
- PostgreSQL 16 dan Redis 7 di Docker Compose, tanpa port publik pada konfigurasi produksi.
- Prisma, migrasi, dan seed data contoh yang ditandai `FIXTURE`.
- Klien UN Comtrade Free API, pembatas laju Redis, dan perencana backfill.
- Pekerja BullMQ untuk sinkronisasi, penjadwal, dan pembuatan Excel.
- Generator `.xlsx` dengan dropdown validasi data, rumus KPI, hierarki HS (outline), dan grafik OOXML asli.
- Autentikasi admin berbasis cookie HMAC.

## Yang belum bisa dianggap selesai

Tidak ada kunci `COMTRADE_API_KEY` di repositori ini. Tanpa kunci, sistem memakai data contoh deterministik. Data itu **bukan** statistik resmi UN Comtrade. Backfill historis 2020–2025 dan Januari–Agustus 2026 belum dijalankan terhadap API sungguhan, jadi cakupan resmi saat ini kosong.

## Menjalankan lokal

Butuh Docker, Node.js 20.18 atau lebih baru, dan salinan `.env`.

```sh
cp .env.example .env
# Isi AUTH_SECRET, ADMIN_PASSWORD (minimal 12 karakter), POSTGRES_PASSWORD, REDIS_PASSWORD.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Untuk perintah di host, arahkan `DATABASE_URL` ke `127.0.0.1:55432` dan `REDIS_URL` ke `127.0.0.1:56379` seperti komentar di `.env.example`. Lalu buka `http://localhost:3000/login`. Untuk tumpukan produksi, lihat [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Panduan pemakaian ada di [docs/PANDUAN-PENGGUNA.md](docs/PANDUAN-PENGGUNA.md). Cadangan basis data ada di [docs/BACKUP.md](docs/BACKUP.md).

## Perintah

```sh
npm test
npm run typecheck
npm run build
npm run worker:ingestion
npm run worker:scheduler
npm run worker:exports
```

Uji otomatis memakai fixture dan tidak menghabiskan kuota UN Comtrade.

## Excel

Preset **LAPORAN PERDAGANGAN INDONESIA LENGKAP** mengantre workbook `INDONESIA_TRADE_INTELLIGENCE.xlsx`:

1. `01 DASHBOARD` — dropdown negara, periode, dan komoditas; KPI berupa rumus; grafik asli.
2. `02 SUMMARY ALL COUNTRIES` — satu baris per mitra dan periode dari observasi TOTAL.
3. Satu lembar per negara atau wilayah, dengan outline HS2 → HS4 → HS6 → HS8 bila tersedia.
4. `04 COVERAGE` — status kelengkapan.

Nilai yang tidak ada ditulis `n.a.`, bukan nol. Jika volume melewati batas praktis Excel, ekspor menjadi paket zip berisi beberapa workbook dan `MANIFEST.json`.
