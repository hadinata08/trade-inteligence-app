# Deployment

Semua layanan berjalan di satu host Docker. PostgreSQL dan Redis tidak dipublikasikan pada `docker-compose.yml`. Hanya Nginx yang membuka `${HTTP_PORT:-8080}`.

## Persiapan

1. Salin `.env.example` menjadi `.env`.
2. Ganti `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `AUTH_SECRET`, dan `ADMIN_PASSWORD`.
3. `AUTH_SECRET` minimal 16 karakter. `ADMIN_PASSWORD` minimal 12 karakter.
4. Simpan `COMTRADE_API_KEY` hanya di `.env` server. Kosongkan bila belum berlangganan; aplikasi akan menolak backfill langsung dan tetap bisa memuat data contoh dari halaman admin.
5. Set `NEXT_PUBLIC_APP_URL` ke URL publik, misalnya `https://trade.example.com`.

Jangan menaruh kunci API di repositori, variabel `NEXT_PUBLIC_*`, atau berkas Excel.

## Menjalankan

```sh
docker compose up -d --build
```

Urutan layanan:

- `postgres` dan `redis` menunggu health check.
- `migrate` menjalankan `prisma migrate deploy` sekali. Perintah ini tidak menghapus data.
- `web`, `worker`, `exports`, dan `scheduler` baru start setelah migrasi sukses.
- `nginx` menunggu health check web di `http://127.0.0.1:3000/api/health`.

Nama host internal:

- `postgres:5432`
- `redis:6379`
- `web:3000`

## TLS

Konfigurasi Nginx sudah menyiapkan header keamanan dan batas waktu unggah 600 detik. Blok TLS di `infrastructure/nginx/nginx.conf` dikomentari. Pasang sertifikat di host, buka blok itu, dan publikasikan port 443 bila sertifikat tersedia. Jangan menaruh rahasia sertifikat di repositori.

## Pengembangan di host

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Port host `55432`, `56379`, dan `3000` hanya terikat ke `127.0.0.1`. Di dalam kontainer, aplikasi tetap memakai `postgres:5432` dan `redis:6379`. Sesuaikan `DATABASE_URL` dan `REDIS_URL` di `.env` ke `127.0.0.1` seperti komentar di `.env.example`, lalu jalankan `npm run db:migrate`, `npm run db:seed`, `npm run dev`, dan ketiga pekerja.

## Pemulihan proses

- Pekerja sinkronisasi menandai pekerjaan `RUNNING` yang macet lebih dari 30 menit menjadi `PENDING`.
- Kuota API adalah jendela bergulir 24 jam, dilacak di Redis dan dicatat di tabel `api_usage`. Anggaran operasional bawaan 450 dari batas penyedia 500.
- Redis memakai AOF. Antrean yang hilang dapat diantre ulang dari baris `sync_jobs` berstatus `PENDING`.
- Volume `iti_pgdata`, `iti_redis`, dan `iti_exports` tidak dihapus oleh `docker compose up`. Jangan menjalankan `docker compose down -v` pada produksi.

## Mematikan

`docker compose down` menghentikan kontainer dan mempertahankan volume. Setiap proses memakai `tini` atau penanganan `SIGTERM` agar pekerja menutup antrean sebelum keluar.
