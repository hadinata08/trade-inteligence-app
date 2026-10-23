# Panduan pengguna

Antarmuka memakai Bahasa Indonesia. Masuk dengan email dan kata sandi admin yang ada di konfigurasi server.

## Dasbor

Angka ekspor, impor, dan neraca dibaca dari ringkasan TOTAL yang sudah tersimpan. Neraca adalah ekspor dikurangi impor. Satuan tampilan adalah juta USD. `n.a.` berarti observasi tidak ada, bukan nilai nol.

Jika pita sumber bertuliskan **DATA CONTOH**, angka itu dibuat untuk uji aplikasi dan bukan statistik UN Comtrade.

## Negara dan komoditas

Buka satu mitra untuk melihat riwayat tahunan dan pohon HS. Baris HS2 dimuat lebih dulu. Tingkat di bawahnya diambil dari server saat baris dibuka. Pencarian komoditas juga dipaginasi di server.

Kumulatif Januari–Agustus 2026 hanya resmi bila kedelapan bulan terverifikasi. Jika ada bulan hilang, statusnya `PARTIAL` dan nilai resmi tidak diisi dari jumlah parsial.

## Excel

1. Buka **Buat Excel**.
2. Pilih **LAPORAN PERDAGANGAN INDONESIA LENGKAP** untuk seluruh mitra, periode, dan tingkat HS yang tersedia, termasuk HS8 bila sumber memang menyediakan tarif line.
3. Tunggu status `COMPLETED`, lalu unduh.
4. Buka berkas di Microsoft Excel. Dropdown negara, periode, dan komoditas pada lembar `01 DASHBOARD` mengubah KPI lewat rumus. Grafik terikat pada rentang bernama, bukan gambar.

Lembar kedua merangkum semua negara dari observasi TOTAL. Jangan menjumlahkan HS2, HS4, dan HS6 menjadi satu total. Setiap negara punya satu lembar utama dengan pengelompokan outline.

Lembar cakupan membedakan `COMPLETE`, `PARTIAL`, `MISSING`, `UNAVAILABLE`, `UNVERIFIED`, dan `FAILED`. HS8 yang tidak didukung langganan Free API ditandai tidak tersedia dan tidak diisi dengan angka rekaan.

## Admin sinkronisasi

Halaman admin menampilkan status kunci API tanpa menampilkan kunci itu, pemakaian kuota 24 jam, tahap pekerjaan, dan kegagalan.

- **Muat data contoh** mengisi basis data dengan fixture berlabel.
- **Mulai backfill** hanya berjalan bila `COMTRADE_API_KEY` terpasang di server. Perkiraan kebutuhan sekitar 800 panggilan, sehingga backfill penuh membutuhkan lebih dari satu hari pada anggaran 450 panggilan.
- Jeda dan lanjutkan menghentikan antrean tanpa menghapus pos pemeriksaan.
- Segarkan satu negara atau satu periode mengantre ulang partisi terkait.

Jangan menganggap dataset lengkap selama halaman cakupan masih menunjukkan periode atau tingkat HS yang `MISSING` atau `UNVERIFIED`.
