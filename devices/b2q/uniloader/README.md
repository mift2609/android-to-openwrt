# uniLoader untuk b2q — apa yang diubah dan kenapa

Yang diambil dari upstream `ivoszbg/uniLoader` (SIMPLE_FB default `y`, jadi layar dipakai
sebagai kanal diagnosa), lalu ditambah empat hal. Semua alasan di bawah berasal dari kegagalan
yang terdokumentasi di port Samsung Qualcomm lain (Tab S8+/S22, SM8450) — bukan tebakan.

| # | Berkas | Perubahan | Alasan (gejala kalau tidak) |
|---|---|---|---|
| 1 | `board/samsung/board-b2q.c` | board baru + entri `SAMSUNG_B2Q` di `board/Kconfig` + `board/Makefile` | tanpa board, uniLoader tidak tahu framebuffer mana yang dipakai |
| 2 | `arch/aarch64/load-kernel.c` | salinan byte-per-byte (`safe_copy`) untuk kernel+ramdisk | dengan MMU mati semua akses Device-nGnRnE; pola 16/32-byte `memcpy.S` (optimized-routines) mengasumsikan unaligned access boleh → Alignment fault → **reset loop sebelum ada console** |
| 3 | `Makefile` | `-mstrict-align` di `KBUILD_CFLAGS` | mencegah compiler membuat akses tak-teraligned sendiri di kode C loader |
| 4 | `Kconfig` + `load-kernel.c` | `DTB_RELOCATE` / `DTB_ENTRY` (meniru patch S22) | DTB tertanam duduk **di dalam** image loader (~55 MB); kalau image itu mendarat di area yang bagi Linux harus jadi carveout (pil_modem/pil_adsp), kernel me-reserve DTB lebih dulu → carveout gagal di-reserve → remoteproc tidak probe |

## Cara menyiapkan pohon uniLoader untuk b2q

```bash
git clone --depth 1 https://github.com/ivoszbg/uniLoader ~/b2q-openwrt/build/uniLoader
cd ~/b2q-openwrt/build/uniLoader
cp <repo>/devices/b2q/uniloader/board-b2q.c board/samsung/board-b2q.c
# tambahkan ke board/Kconfig:  config SAMSUNG_B2Q (depends on SM8350)
# tambahkan ke board/Makefile: lib-$(CONFIG_SAMSUNG_B2Q) += samsung/board-b2q.o
# terapkan perubahan 2, 3, 4 di atas (lihat komentar di berkasnya)
cp <repo>/devices/b2q/uniloader/b2q_defconfig configs/b2q_defconfig
# blob/: Image (Image.gz di-decompress!), dtb (DTB perangkat), ramdisk (initramfs)
make ARCH=aarch64 CROSS_COMPILE=aarch64-linux-gnu- b2q_defconfig
make ARCH=aarch64 CROSS_COMPILE=aarch64-linux-gnu-
# hasil: uniLoader.gz (~17 MB) -> dipakai sebagai KERNEL di boot image
```

Boot image dibangun dengan `scripts/tools/mkbootimg.py`, header **v3** (format boot stok b2q)
atau **v2** dengan `--dtb` + `--board SRPUC03A013` (format TWRP yang sudah terbukti diterima
bootloader perangkat ini). Kernel `uniLoader.gz` **wajib** identik hasil bongkar-ulang dengan
berkas yang dikirim — `pack-bootimg.sh` sudah memeriksa itu.

## Kalau tetap gagal senyap

Urutan yang paling murah dibuktikan:
1. Layar: `CONFIG_SIMPLE_FB=y` + `board-b2q.c` menunjuk framebuffer `0xe1000000` (nilai ini
   terverifikasi dari `splash_memory` di dtb Samsung perangkat sendiri). Kalau muncul teks
   uniLoader → loader jalan, masalahnya di handoff kernel. Kalau layar tetap gelap → ABL
   tidak menerima image, atau loader fault sebelum bisa menggambar.
2. DTB kernel: pastikan `/memory` **bukan** ukuran 0 (lihat `devices/b2q/dts/`). Dengan
   ukuran 0 kernel menerima 0 byte RAM dan panik seketika tanpa satu baris pun.
3. `TEXT_BASE`/`PAYLOAD_ENTRY`/`RAMDISK_ENTRY`: hitung dari peta carveout perangkat, jangan
   salin dari ponsel lain.
