# Spec — Indonesia Trade Intelligence, redesign situs

Dibuat mengikuti skill huashu-design (alchaincyf/huashu-design @798c423). Spec ini hanya "apa yang harus disampaikan"; tampilan ada di `directions.md`.

## Proyek
Dasbor web internal untuk menelusuri perdagangan barang Indonesia (sumber UN Comtrade, disimpan di PostgreSQL). Workbook Excel tetap keluaran utama; situs dipakai untuk menjelajah dan memeriksa angka sebelum membuat Excel.

## Pengguna dan situasi
- Analis internal; membuka dasbor setiap hari, membandingkan negara, tahun, dan kode HS, lalu membuat laporan.
- Butuh: padat tapi cepat dibaca, angka presisi dan konsisten dengan Excel, filter cepat.
- Nuansa: tenang dan institusional (pilihan pengguna, 2026-10-21). Bukan pemasaran.

## Isi yang wajib ada (dari dokumen revisi "Repisi")
1. Filter: Negara (World atau satu mitra), Tahun multi-pilih, Level HS (HS2/4/6), Kode HS (halaman negara), Reset.
2. Kartu ringkasan: Total ekspor, Total impor, Surplus/defisit neraca, Pertumbuhan (%) — semua bersatuan.
3. Kinerja tahunan dan tren 2020–2025 dengan rentang yang sama, garis lurus, sumbu bersatuan.
4. Komposisi ekspor dan impor per kode HS (treemap atau donut) dengan uraian, nilai, dan persen.
5. Top 5 komoditas dengan kenaikan YoY tertinggi (%), label kode + nama.
6. Top 10 komoditas ekspor dan impor (tabel ber-header).
7. Peringkat mitra (World saja).
8. Status data (UN Comtrade vs DATA CONTOH) harus jujur dan terlihat.

## Data untuk prototipe
Angka resmi UN Comtrade dari workbook 2026-10-20 (`data-official-2025.json`), World, 2025, HS2. Tidak ada angka karangan.

## Format dan ukuran (sama untuk ketiga arah)
Satu file HTML per arah; layar 1440×900 dan 375×812 (ponsel). Bahasa Indonesia. Teks isi ≥14px, label ≥12px, kontras ≥4.5:1.

## Batasan
- Harus bisa diterapkan ke Next.js + Tailwind + Recharts yang ada (tanpa ilustrasi atau foto).
- Tampilan sekarang (krem, serif, aksen tembaga, label kapital kecil) adalah "Warm Editorial", tampilan default AI menurut skill; harus ditinggalkan.
