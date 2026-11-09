# 04 — Backup & pemulihan (baca SEBELUM menulis partisi apa pun)

Deliverable yang benar bukan "aku sudah backup": melainkan **set berkas + panduan tertulis** yang
membuatmu bisa memulihkan sendiri, tanpa bantuan siapa pun.

## 1. Tentukan partisi dari ISI-nya, bukan dari indeks

Pembaca label GPT di device sering gagal senyap. Trik yang terbukti: bandingkan 4 MB pertama tiap
kandidat dengan image stok yang sudah kamu punya.

```sh
# di device (busybox/root)
dd if=/dev/mmcblk0pNN bs=1M count=4 | md5sum
```
```bash
# di host
dd if=recovery.img bs=1M count=4 | md5sum
```
Yang cocok dengan `recovery.img` = partisi recovery; pasangannya (biasanya satu indeks sebelum)
adalah `boot`. Ukuran cepat: `cat /proc/partitions | awk '$4 ~ /p[0-9]+$/'`.

## 2. Backup DUA keadaan

**a) Keadaan stok — jalur pulang.** `boot`, `recovery`, `persist`, `modem`, `fsg`, `modemst1/2`,
lalu md5 ke `MD5SUMS.txt` dan verifikasi `md5sum -c MD5SUMS.txt`.

**b) Keadaan yang sedang jalan — yang benar-benar kamu pakai untuk pulih.**

```sh
# dump partisi boot apa adanya (lk2nd + kernel). Ini ARSIP, bukan artefak fastboot:
dd if=/dev/block/bootdevice/by-name/boot of=/tmp/boot-current.img bs=1M

# rootfs hidup: busybox tar tidak punya --exclude -> sebut direktori top-level eksplisit
tar czf /tmp/rootfs-full.tgz -C / etc usr opt bin sbin lib root var www
```

Kalau rootfs berbasis ext4 dan sudah pernah di-mount, pakai `-X` (satu pola per baris) dan
sertakan `./lost+found`. Verifikasi isi tarball: minimal `sbin/init`, hash sandi di `etc/passwd`,
binari layanan, dan `lib/modules`.

**c) Partisi data besar** (mis. `userdata` 23 GB) tidak di-backup — dokumentasikan saja bentuknya.
Ext4 bawaan Android memakai `quota`, jadi pembuatan ulang bukan `mkfs.ext4` polos:
`mkfs.ext4 -O quota -L userdata /dev/block/bootdevice/by-name/userdata`.

## 3. Di mana image ini harus ditulis (jebakan paling mahal)

Banyak perangkat Qualcomm menaruh **lk2nd di dalam partisi `boot`** (offset 0; kernel di 512 KiB).
Konsekuensinya:

- **Jangan** memakai menu "Install Image → Boot" ala TWRP — itu menulis di offset 0 dan menghapus
  lk2nd. Setelah itu `aboot` stok tidak bisa boot kernel mainline sama sekali.
- Flash dari **fastboot** (`fastboot flash boot <img>`): saat lk2nd yang menjawab, penulisan di
  offset 512 KiB dilakukan otomatis.
- Kalau terpaksa lewat TWRP, lewat Terminalnya:
  `dd if=/external_sd/boot.img of=/dev/block/bootdevice/by-name/boot bs=512 seek=1024`.
- **Dump partisi boot 64 MB bukan artefak yang bisa di-flash**: isinya lk2nd (offset 0) + kernel
  (512 KiB); `fastboot flash boot dump.img` akan menggeser semuanya 512 KiB dan merusak boot.
  Yang boleh di-flash selalu `boot.img` hasil `pack-bootimg.sh`.
- Simpan `lk2nd-<soc>.img` di host **selama** lk2nd hidup di partisi `boot`. Kalau terhapus:
  bootloader stok masih menjawab fastboot → `fastboot flash boot lk2nd-<soc>.img`.

Tulis angka offset ini di profil perangkat (`LK2ND_OFFSET_KIB`) setelah kamu **mengukurnya** —
jangan mengasumsikan 512 KiB karena "biasanya begitu".

## 4. Pemulihan yang perlu ditulis di panduanmu

Satu bagian per skenario, dengan perintah siap tempel dan nomor partisi eksplisit:

1. **Restore boot saja** (kernel percobaan bikin crash-download) — kasus paling sering.
2. **Restore rootfs saja** (sistem naik tapi layanan rusak).
3. **Flash bersih dari nol** (boot + userdata/rootfs).
4. **Revert total ke Android** (boot stok + recovery stok + format userdata).
5. **Format ulang partisi data** (dengan `-O quota`).

Tambahkan peta partisi (nomor, nama, ukuran, dan partisi yang **tidak boleh ditulis**:
`persist`, `modem`, `fsg`, `modemst*`) serta kombinasi tombol masuk fastboot.

## 5. Realitas kecepatan & kegagalan fastboot (biar tidak panik di tengah jalan)

- USB 2.0 ≈ 13 MB/s: boot image 21 MB ≈ 1 s, rootfs 1,5 GB ≈ 2 menit, 4 GB ≈ 5,5 menit.
  **Sebutkan estimasi ini ke siapa pun yang menunggu**, karena tanpa angka orang mengira
  prosesnya menggantung lalu mencabut kabel.
- **Jangan menjalankan dua `fastboot flash` sekaligus** pada perangkat yang sama: yang kedua
  menunggu di `< waiting for any device >`, lalu keduanya berebut partisi. Cek `pgrep -af fastboot`.
- **Jangan menyentuh berkas image saat flash sedang membaca berkas itu** (`cp`, `truncate`,
  `resize2fs`): fastboot menghitung ukuran ngawur dan menulis sampah — tampak seperti masalah kabel.
- **`Status read failed (No such device)`** = HP lepas dari USB, **bukan** image rusak. Partisi
  setengah tertulis dan harus ditulis ulang. Rootfs setengah tulis biasanya masih "naik" tapi
  jatuh ke kandidat rootfs berikutnya — jangan simpulkan image cacat sebelum memeriksa.
- **Crash-download (`05c6:900e QUSB__BULK` di `lsusb`)**: kernel/init panik dini. Tidak pulih
  sendiri. Urutannya: cabut USB → tahan Power 15–20 s sampai benar-benar mati → Vol Down + Power →
  `fastboot flash boot <image-yang-terbukti-jalan>` → `fastboot reboot`.
- **`Write to device failed (Protocol error)`**: endpoint fastboot terkunci. Paksa power off
  (10–15 s), lalu kembali ke fastboot dengan tombol.

## 6. Bentuk set yang user harapkan

Dua berkas + satu panduan: `boot.img`, `userdata.img` (atau tarball rootfs + resepnya), dan
`README-flash-restore.md`. Simpan set yang lengkap (stok + EFS) di direktori kerja, dan hanya
berkas yang benar-benar dipakai di direktori yang mudah ditemukan. Setelah artefak baru dibuat,
**hapus versi lama dan perbarui SEMUA dokumen yang merujuknya** — panduan yang menyuruh mem-flash
berkas yang sudah dihapus itu jebakan untuk sesi berikutnya. Dan selalu sisakan backup partisi
stok: itu satu-satunya jalan pulang ke Android.
