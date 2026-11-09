# 06 — Troubleshooting: gejala → sebab → tindakan

Semua baris di bawah berasal dari kegagalan nyata di perangkat nyata.

## Boot

| Gejala | Sebab paling mungkin | Tindakan |
|---|---|---|
| `fastboot boot` balas `OKAY`, lalu gelap, tanpa USB, tanpa reboot | DTB/PSCI/hardware tidak cocok, atau `fastboot` dijalankan pada **aboot stok** (aboot stok memang tidak bisa boot kernel mainline) | pastikan lk2nd terpasang di partisi boot; cek ulang nama DTB untuk varian hardware yang tepat |
| Reboot ke fastboot dalam ~0,1 s, tanpa satu baris log | `CONFIG_ARM64_VA_BITS_52=y` di Core ARMv8.0/8.1 (Cortex-A53) | paksa 48-bit di fragment (`CONFIG_ARM64_VA_BITS_48=y`), lalu buktikan `CONFIG_ARM64_VA_BITS=48` di `.config` |
| Perangkat diam total, tidak ada USB, tidak reboot | initramfs tidak bisa `exec` `/init` (busybox arsitektur **host** di ramdisk arm64), atau `/init` mati sebelum gadget (mis. `exec >/dev/tty0` tanpa penjaga) | `file bin/busybox` harus aarch64; jaga redireksi console dengan `if [ -e /dev/tty0 ]`; taruh konfigurasi gadget paling awal |
| Tidak ada `/sys/class/udc`, gadget tidak bind, host tidak melihat apa pun | PHY/dwc3 modular (`=m`) → probe terjadi setelah initramfs, atau `dr_mode = "otg"` | `CONFIG_PHY_QCOM_QUSB2=y`, `CONFIG_USB_DWC3=y`, `CONFIG_USB_CONFIGFS=y`; ubah `dr_mode` ke `peripheral` di DTB |
| Kernel terlihat jalan tapi layar hitam | panel belum dipilih (khas perangkat yang butuh **lk2nd** untuk memilih panel), atau DRM/SimpleDRM tidak built-in | pasang lk2nd; `CONFIG_DRM=y` + `CONFIG_DRM_SIMPLEDRM=y` + `CONFIG_FRAMEBUFFER_CONSOLE=y` |
| Tidak jelas apakah kernel sampai userspace | tidak ada instrumentasi | taruh `panic=5` di cmdline; tes `init=/nope`: reboot = kernel sampai userspace (salahnya di init), diam = kernel berhenti sebelum userspace |

## Jaringan

| Gejala | Sebab paling mungkin | Tindakan |
|---|---|---|
| `ping 192.168.42.1` gagal, tapi perangkat jelas hidup | host mengirim trafik lewat router rumah | `ip route get 192.168.42.1` — harus lewat netdev USB; pakai `host-connect.sh` (never-default) |
| `lsusb` tidak menemukan VID perangkat | kamu mencari VID pabrikan | gadget configfs = `1d6b:xxxx Linux Foundation`, dengan `product` = hostname/board |
| Ping balas padahal perangkat mati | yang menjawab router rumahmu | verifikasi kedua sisi (`lsusb`, `ip -o link`, rute) — jangan percaya ping saja |
| DHCP tidak memberi alamat | AP/gadget naik **setelah** netifd/dnsmasq memproses interface | naikkan gadget lebih awal (`START=15` dan seterusnya) atau reload network setelah interface ada |
| NAT tidak jalan, klien dapat IP tapi tanpa internet | `ip_forward=0`, zona wan tanpa `masq=1`, atau nftables tidak ada di kernel | `cat /proc/sys/net/ipv4/ip_forward`; `nft list ruleset`; pakai `firewall4` hanya kalau `CONFIG_NF_TABLES=y` |
| Uplink LTE hilang padahal modem hidup (`No modems were found`) | urutan probe driver IPA/remnet, bukan kerusakan | baca log watchdog; retry 60 s biasanya memulihkan. Baru setelah itu anggap kernel bermasalah |

## Sistem & alat

| Gejala | Sebab | Tindakan |
|---|---|---|
| SSH selalu menolak sandi walau sudah di-set | di musl, `getspnam` butuh hash di **dua** tempat | tulis hash yang sama di field 2 `/etc/passwd` **dan** 9 field `/etc/shadow` |
| `procd` tidak jalan dari initramfs | `ujail` tidak bisa hidup di ramfs | nonaktifkan pembantu jail di `/lib/functions/procd.sh` saat ramfs |
| `tar` mengeluh `--exclude` tidak dikenal | busybox tar | pakai `-X <file>` (satu pola per baris) atau sebut direktori top-level eksplisit |
| Rootfs naik tapi layanan mati, tanpa pesan | `/dev /proc /sys /tmp` tidak ada di dalam rootfs setelah `switch_root` | buat direktori itu (dan `/tmp` mode 1777) sebelum `mkfs`/tar, lalu verifikasi |
| LuCI tidak menampilkan suhu SoC (`Permission denied`) | ACL rpcd, bukan izin filesystem | tambahkan `"/sys/class/thermal/thermal_zone*/temp": ["read"]` di `/usr/share/rpcd/acl.d/luci-mod-status-index.json`, restart rpcd, bersihkan cache `/tmp/luci-*` |
| `mkfs` ditolak saat membuat `userdata.img` | operasi pemformatan diblokir di lingkungan otomatis | serahkan skrip kecil untuk dijalankan sendiri oleh pengguna; atau perbesar/perkecil image tanpa `mkfs` (`e2fsck` + `resize2fs` + `truncate`) |

## Fastboot

- **`partition table doesn't exist`** saat flash ke partisi `lk2nd`: perangkat ini tidak punya
  partisi itu. Flash lk2nd ke `boot` dari fastboot stok.
- **`FAILED (remote: 'dtb not found')`**: bootloader tidak membaca DTB dari header boot image →
  append DTB ke kernel (`cat Image.gz board.dtb > Image.gz-dtb`).
- **`mkbootimg.py` mati dengan `ModuleNotFoundError: No module named 'gki'`**: impor GKI di
  AOSP harus dibungkus `try/except` (versi yang ada di `scripts/tools/` sudah dibungkus).
- **Perintah flash "tidak berefek"**: periksa apakah flash benar-benar terjadi di offset yang
  dibaca bootloader (lihat docs/04 §3). Membaca balik di offset yang sama dengan yang kamu tulis
  selalu cocok — itu bukan bukti.
