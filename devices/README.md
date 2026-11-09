# Profil perangkat

Satu direktori per perangkat. Nama direktori = nilai `DEVICE` yang dipakai semua skrip:

```bash
make DEVICE=<nama> bootimg
./scripts/chroot/deploy-rootfs.sh --device <nama> --ssh root@<ip>
```

## Struktur

```
devices/<nama>/
├── device.conf             # wajib: identitas, kernel, DTB, argumen mkbootimg, partisi, jaringan
├── kernel.config.fragment  # opsi Kconfig yang WAJIB dipaksa =y untuk perangkat ini
└── README.md               # catatan spesifik: apa yang sudah terbukti, apa yang belum
```

## Aturan penulisan `device.conf`

- Format sh (`KEY="value"`), di-source lewat `load_device`. Jangan taruh perintah yang punya efek samping.
- Wajib ada: `DEVICE_NAME`, `SOC`, `ARCH`, `KERNEL_REPO`, `DTB`.
- `MKBOOTIMG_ARGS` + `KERNEL_CMDLINE` harus **salinan persis** dari boot image yang sudah terbukti boot di
  perangkat itu. Nilai yang "kira-kira mirip" menghasilkan image yang tidak dikenali bootloader.
- `BOOT_PARTITION`/`USERDATA_PARTITION`: pakai jalur `/dev/block/bootdevice/by-name/...`, bukan nomor
  `mmcblk0pNN` (nomor berbeda antar-varian dan mudah berubah). Nomor partisi boleh dicatat di README sebagai
  referensi tambahan.
- `LINK2ND_OFFSET_KIB` (di repo ini: `LK2ND_OFFSET_KIB`): 512 KiB bila bootloader `lk2nd` tinggal di dalam
  partisi `boot`; 0 bila perangkat masih memakai `aboot` stok dan DTB di-append ke kernel. **Ukur, jangan
  asumsikan** — lihat [`docs/04-backup-dan-restore.md`](../docs/04-backup-dan-restore.md).

## Status akurasi

Nilai di dalam `device.conf` bukan tebakan: kernel tag, nama DTB, dan opsi config sudah dicocokkan dengan
repo kernelnya (`gh api`/`curl`), dan argumen mkbootimg berasal dari perangkat yang benar-benar boot.
Kalau kamu menambah perangkat baru, tulis di README-nya **apa yang sudah kamu buktikan sendiri** —
jangan menyalin status perangkat lain.
