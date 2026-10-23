# Cadangan dan pemulihan PostgreSQL

Cadangan diambil dari kontainer `postgres` yang sedang berjalan. Berkas dump tidak boleh di-commit.

## Cadangan

```sh
sh scripts/backup.sh
```

Skrip menulis `backups/iti-UTCSTAMP.dump` dalam format kustom `pg_dump -Fc`. Beri jalur lain bila perlu:

```sh
sh scripts/backup.sh /secure/iti.dump
```

Jadwalkan perintah itu di host, misalnya setiap hari, dan salin hasilnya ke penyimpanan di luar mesin Docker. Volume `iti_pgdata` saja bukan cadangan yang cukup.

## Pemulihan

Hentikan `web`, `worker`, `exports`, dan `scheduler` agar tidak menulis selama pemulihan. Biarkan `postgres` menyala.

```sh
docker compose stop web worker exports scheduler
sh scripts/restore.sh backups/iti-UTCSTAMP.dump
docker compose start web worker exports scheduler
```

`pg_restore --clean --if-exists` mengganti objek yang ada. Ini operasi merusak data saat ini. Uji dump di basis data kosong sebelum memakainya untuk pemulihan produksi.

## Redis dan berkas Excel

Redis menyimpan antrean dan pembatas laju, bukan arsip perdagangan. Setelah Redis kosong, jalankan kembali penjadwal; pekerjaan yang masih `PENDING` di PostgreSQL akan diantre ulang.

Berkas Excel ada di volume `iti_exports`. Salin volume itu terpisah bila unduhan historis harus dipertahankan. Laporan dapat dibuat ulang dari PostgreSQL.
