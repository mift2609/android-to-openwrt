# android-to-openwrt

Toolkit untuk mengubah **HP Android berbasis Qualcomm** menjadi router **OpenWrt**: skrip,
profil perangkat, pipeline kernel (lokal + GitHub Actions), dan panduan pemulihan.

Repo ini tidak menyimpan binary apa pun. Yang disimpan adalah **prosedur yang bisa diverifikasi** —
termasuk skrip yang membuktikan pekerjaannya sendiri (hash rootfs, fragment config benar-benar
mendarat di `.config`, kernel di dalam `boot.img` identik dengan yang dikirim).

---

## Dua jalur

| | Jalur A — OpenWrt di atas Android | Jalur B — Mainline Linux (bare-metal) |
|---|---|---|
| Cara kerja | rootfs OpenWrt resmi dijalankan di `chroot`/container di atas kernel Android | kernel mainline + OpenWrt penuh menggantikan Android |
| Syarat | HP **root** (Magisk/KernelSU/APatch), arm64 | bootloader terbuka + `lk2nd` + backup partisi |
| Risiko | nyaris nol (Android tetap utuh) | nyata — baca [`docs/04`](docs/04-backup-dan-restore.md) dulu |
| `kmod-*` OpenWrt | tidak bisa | bisa |
| Status | skrip host teruji; eksekusi di HP belum diuji oleh penulis¹ | **terbukti** di Redmi Note 4X² |

¹ Jalur A diuji secara mekanis (unduh + sha256 rootfs, ekstraksi, sesi chroot di host).
Untuk jalur A yang matang di HP, repo ini justru menyarankan runtime container yang sudah ada:
**Droidspaces** (`ravindu644/Droidspaces-OSS` + WebUI `latifangren/droidspaces-webui`) — katalog
rootfs-nya sudah memuat OpenWrt 24.10 dan otomatis menambal masalah khas Android (grup socket
`inet`/`net_raw`, DHCP, DNS fallback). Lihat [`docs/02`](docs/02-jalur-a-chroot.md).

² **[`devices/mido`](devices/mido/README.md)** — Redmi Note 4X (MSM8953): OpenWrt 24.10.5, kernel
`6.19.5-postmarketos-qcom-msm8953`, `procd`+`ubus`+`netifd`, RNDIS + SSH + LuCI, AP WiFi, uplink
LTE, dan set backup/pemulihan yang sudah terverifikasi md5.

---

## Quick start

```bash
git clone https://github.com/mift2609/android-to-openwrt && cd android-to-openwrt
make check                       # uji sintaks semua skrip + round-trip boot image
make test                        # uji tambahan (rakit initramfs nyata; --network untuk uji unduh rootfs)
```

**Jalur A — coba hari ini, tanpa flash apa pun**

```bash
make rootfs ARCH=arm64                                     # unduh + sha256 rootfs OpenWrt arm64
./scripts/chroot/deploy-rootfs.sh --device mido --ssh root@192.168.42.1 \
    --tarball out/rootfs/openwrt-24.10.5-armsr-armv8-rootfs.tar.gz
ssh root@192.168.42.1 'sh /data/local/openwrt/enter.sh'    # shell OpenWrt
```

**Jalur B — HP jadi router sungguhan**

```bash
# 1) pasang profil perangkat baru (untuk perangkat selain mido/rolex)
./scripts/devices/new-device.sh --list
./scripts/devices/new-device.sh --name santoni --soc msm8953 --codename santoni

# 2) ukur nilai yang wajib (argumen mkbootimg, partisi, bootloader mana yang menjawab)
./scripts/devices/probe-device.sh --device santoni --boot-img boot-stok.img --update-profile

# 3) backup dulu (docs/04), lalu bangun di CI
gh workflow run build-kernel.yml -f device=santoni -f kernel_tag=v6.19.5-r0
# atau lokal:
make DEVICE=santoni kernel initramfs bootimg     # -> out/santoni/boot.img

# 4) uji tanpa menulis, baru flash
fastboot boot out/santoni/boot.img
fastboot flash boot out/santoni/boot.img
./scripts/net/host-connect.sh                    # host: 192.168.42.2/24, never-default, + bukti rute
```

---

## Perangkat yang didukung

Tabel lengkap + status di [`socs/qualcomm-soc-family.conf`](socs/qualcomm-soc-family.conf)
(diverifikasi ke GitHub API lewat `./scripts/devices/new-device.sh --check-socs`):

| Keluarga SoC | Repo kernel mainline | Device umum |
|---|---|---|
| MSM8916 / MSM8939 | `msm8916-mainline/linux` | Snapdragon 410/615, ratusan device |
| MSM8917/8920/8937/8940, SDM429/439, QM215 | `msm89x7-mainline/linux` | Redmi 4A (`rolex`), Redmi 5A (`riva`) |
| MSM8953 / MSM8953 Pro | `msm8953-mainline/linux` | Redmi Note 4X (`mido`), Redmi 4X (`santoni`), Mi A1 (`tissot`) |
| SDM636 / SDM660 | `sdm660-mainline/linux` | Redmi Note 5 Pro (`whyred`), Redmi Note 7 (`lavender`) |
| MSM8998 | `msm8998-mainline/linux` (berbasis branch) | Mi 6, Mi Mix 2 |
| MSM8226/8974 | `msm8226-mainline/linux` | Galaxy S5, OnePlus One |

Menambah perangkat lain = 3 perintah + satu kali ukur di perangkat:
[`docs/07-menambah-perangkat.md`](docs/07-menambah-perangkat.md).

---

## Isi repo

```
socs/               tabel keluarga SoC Qualcomm -> repo kernel + lk2nd (terverifikasi)
devices/<nama>/     profil: device.conf, kernel.config.fragment, README status apa yang terbukti
scripts/devices/    new-device.sh (scaffold + verifikasi), probe-device.sh (ukur dari perangkat)
scripts/openwrt/    fetch-rootfs.sh (unduh + sha256 + cek arsitektur busybox)
scripts/chroot/     deploy-rootfs.sh + enter.sh (jalur A)
scripts/build/      build-kernel.sh, apply-config-fragment.sh, mkinitramfs.sh, pack-bootimg.sh, patch-dtb.sh
scripts/net/        host-connect.sh (IP + rute + bukti, tanpa membajak default route host)
rootfs/             /init initramfs + overlay init script procd (contoh nyata, bukan placeholder)
patches/            tambalan DTB/kernel per-perangkat (applier yang gagal keras)
.github/workflows/  build kernel + initramfs + boot.img di CI (ccache per tag)
docs/               panduan per topik (Indonesia)
tests/smoke.sh      uji tanpa perangkat: lint, round-trip boot.img, initramfs, unduh rootfs
```

Setiap skrip yang punya efek nyata memverifikasi hasilnya sendiri, contoh:

- `apply-config-fragment.sh` — tiap simbol dicek ke Kconfig lalu dibuktikan di `.config`
  (termasuk `CONFIG_ARM64_VA_BITS=48`: default choice kernel ini 52-bit, dan itu mematikan boot di Cortex-A53);
- `mkinitramfs.sh` — `busybox` di dalam initramfs wajib berarsitektur target (busybox x86_64 di
  initramfs arm64 = `/init` gagal exec, perangkat tampak mati total);
- `pack-bootimg.sh` — `boot.img` dibongkar ulang dan kernelnya dibandingkan byte-per-byte;
- `fetch-rootfs.sh` — sha256 terhadap `sha256sums` resmi + cek ELF busybox di dalam tarball.

---

## Keamanan & etika

- Jalur B menulis partisi `boot`/`userdata`. Backup dulu; jangan sentuh `persist`, `modem`, `fsg`,
  `modemst*`.
- Di banyak perangkat Qualcomm **lk2nd tinggal di dalam partisi `boot`**: image kernel ditulis di
  offset 512 KiB, dan menu "Install Image → Boot" ala TWRP menghapus lk2nd. Dump partisi boot
  **bukan** artefak yang boleh di-flash. Detail: [`docs/04`](docs/04-backup-dan-restore.md) §3.
- Jalur A butuh root di perangkatmu. Chroot sebagai root = salah ketik bisa merusak data Android.
- Router 24/7: pikirkan baterai (Li-ion mengembung), panas (heatsink), dan antena (u.FL→SMA) —
  [`docs/01`](docs/01-pilih-jalur.md).

Lisensi MIT, tanpa jaminan — lihat [LICENSE](LICENSE).

---

## English (short)

`android-to-openwrt` turns Qualcomm-based Android phones into OpenWrt routers. **Path A**: run an
official OpenWrt arm64 rootfs (`armsr/armv8`) in a chroot/container on a rooted phone (no flashing;
netfilter comes from the Android kernel) — see also the mature container runtimes
`ravindu644/Droidspaces-OSS` and its WebUI. **Path B**: boot mainline Linux + full OpenWrt
(`procd`/`ubus`/`netifd`) bare-metal, proven on Xiaomi Redmi Note 4X (`mido`, MSM8953) with OpenWrt
24.10.5 + kernel 6.19.5.

Adding your own phone is three commands plus one on-device measurement:
`scripts/devices/new-device.sh` verifies the SoC family, kernel repo, tag and DTB through the GitHub
API; `scripts/devices/probe-device.sh` reads the values that must be measured on the device itself
(mkbootimg arguments, partitions, which bootloader answers fastboot). Docs live in `docs/`. MIT.
