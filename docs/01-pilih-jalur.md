# 01 — Pilih jalur: chroot (A) atau mainline (B)

## Ringkas

| Pertanyaan | Jalur A (chroot) | Jalur B (mainline) |
|---|---|---|
| Harus buka bootloader + flash? | tidak | ya |
| Risiko brick | nyaris nol | tinggi kalau tanpa backup |
| Android tetap jalan? | ya (chroot jalan di atasnya) | tidak, digantikan |
| Kernel yang dipakai | kernel Android milikmu | kernel mainline (repo fork per SoC) |
| Bisa pasang `kmod-*` OpenWrt? | tidak | ya |
| Bisa jadi router penuh (NAT, DHCP, DNS, AP, LuCI)? | bisa, selama kernel Android punya netfilter | bisa, penuh |
| Waktu sampai jalan | ~15 menit | beberapa jam sampai beberapa hari |
| Cocok untuk | coba-coba, router darurat, belajar OpenWrt | perangkat permanen, bare-board, tanpa Android |

Kalau tujuanmu HP jadi **device router permanen** (mis. mainboard telanjang + antena + pack 18650),
jalur B yang benar. Kalau tujuannya "aku mau lihat OpenWrt jalan di HP ini malam ini",
jalur A.

## Sisi keras yang perlu dipikirkan (berlaku untuk kedua jalur)

- **Baterai.** HP yang selalu menyala sambil dicas akan mengembung. Pakai charger arus kecil,
  lepas baterai kalau memungkinkan (banyak perangkat tetap hidup dari USB saja), atau batasi
  pengisian lewat kernel/Android.
- **Panas.** Tanpa layar, SoC tetap panas saat jadi router (WiFi + NAT). Tambahkan heatsink
  kecil ke pelat logam SoC kalau dipakai 24/7.
- **Antena.** Untuk WiFi AP, antena internal HP kecil. Kalau mainboard telanjang, sambungkan
  u.FL ke SMA; tanpa antena, WiFi bisa merusak PA-nya.
- **USB.** Kalau mau port Ethernet, ingat USB OTG di banyak HP Qualcomm hanya bekerja saat
  perangkat jadi host (`dr_mode`) — sementara gadget RNDIS/ECM butuh mode peripheral. Satu
  port tidak bisa keduanya sekaligus; ETH-USB biasanya dipakai di jalur B dengan `dr_mode`
  host, dan jaringan ke host lewat WiFi/AP.

## Perangkat apa saja yang bisa (jalur B)

Syarat praktisnya tiga: (1) keluarga SoC-nya punya **fork kernel mainline**, (2) ada
**lk2nd** untuk platform itu, (3) **DTS perangkatmu ada** atau kamu bersedia menulisnya.

Tabel keluarga yang sudah diverifikasi repo ini ada di
[`socs/qualcomm-soc-family.conf`](../socs/qualcomm-soc-family.conf) — MSM8916/8939, MSM8917/8920/8937/8940,
MSM8953, SDM636/660, MSM8998, MSM8226. Untuk perangkat Qualcomm di luar daftar itu, kerja
pertamanya adalah mencari tahu apakah ada fork mainline untuk SoC-nya; kalau tidak ada, itu
proyek porting kernel (berbulan-bulan), bukan penambahan profil.

Perangkat yang **tidak** cocok: bootloader tidak bisa di-unlock, tidak ada source kernel mainline
untuk SoC-nya (banyak chipset MediaTek/Unisoc), atau bootloader-nya memakai verifikasi ketat
(mis. perangkat Samsung pasca-Knox).

## Cara mulai

- Jalur A → [`02-jalur-a-chroot.md`](02-jalur-a-chroot.md)
- Jalur B → [`04-backup-dan-restore.md`](04-backup-dan-restore.md) dulu, lalu
  [`03-jalur-b-mainline.md`](03-jalur-b-mainline.md)
- Perangkat baru → [`07-menambah-perangkat.md`](07-menambah-perangkat.md)
