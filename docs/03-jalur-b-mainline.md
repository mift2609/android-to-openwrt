# 03 — Jalur B: mainline Linux + OpenWrt bare-metal

Urutan kerja: **profil → probe → backup → kernel → initramfs → boot.img → uji tether →
flash → rootfs → verifikasi**. Jangan melompati langkah 2 dan 3.

## 0. Profil perangkat

```bash
./scripts/devices/new-device.sh --list                     # keluarga SoC yang didukung
./scripts/devices/new-device.sh --name santoni --soc msm8953 --codename santoni
```
Skrip itu memverifikasi repo kernel, tag, DTB, dan lk2nd lewat GitHub API sebelum menulis profil.
Profil yang sudah ada: `devices/mido` (terbukti), `devices/rolex` (kerangka terverifikasi).

## 1. Probe: baca nilai yang wajib diukur

```bash
./scripts/devices/probe-device.sh --device santoni --boot-img boot-stok.img --update-profile
```
Yang diambil, dan mengapa tidak boleh ditebak:

- **argumen mkbootimg** (`--base`, `--kernel_offset`, `--ramdisk_offset`, `--tags_offset`,
  `--pagesize`, `--header_version`) — dari boot image yang sudah terbukti boot di perangkat itu.
  Satu nilai beda = bootloader tidak mengenali image.
- **cmdline** (termasuk `console=` SoC dan `panic=5` untuk observabilitas).
- **bootloader yang menjawab fastboot**: aboot stok (~3 entri `partition-type:`) vs lk2nd
  (puluhan entri). Ini menentukan di mana image kernel harus ditulis (offset 0 vs 512 KiB).
- **nama partisi** `boot`/`userdata` dari `by-name` (jangan pakai nomor `mmcblk0pNN`).

## 2. Backup (wajib — lihat docs/04)

Backup `boot`, `recovery`, `modem`, `persist`, `fsg`, `modemst1/2` + md5, dan simpan
`lk2nd-<soc>.img` di host. Tanpa ini jangan lanjut.

## 3. Bangun kernel

CI (disarankan: ccache membuat build kedua ~menit, bukan puluhan menit):

```bash
gh workflow run build-kernel.yml -f device=santoni -f kernel_tag=v6.19.5-r0
gh run list --limit 3
gh run view <run-id> --json status,conclusion -q '".status + \" \" + .conclusion"'
gh run download <run-id> -n boot-img-santoni-v6.19.5-r0 -D out-artifact
```

Lokal:

```bash
make DEVICE=santoni kernel        # unduh tarball tag, defconfig + fragment, Image.gz dtbs modules
make DEVICE=santoni initramfs     # busybox aarch64 statis + /init  -> initramfs.cpio.gz
make DEVICE=santoni bootimg       # append DTB, mkbootimg, lalu bongkar ulang untuk verifikasi
```

Hal yang **diverifikasi** oleh pipeline ini, bukan diasumsikan:

- setiap opsi di `kernel.config.fragment` ada di Kconfig dan benar-benar mendarat di `.config`
  (termasuk `CONFIG_ARM64_VA_BITS=48` — default choice-nya 52-bit dan itu mematikan boot di Core ARMv8.0);
- `busybox` di initramfs benar-benar berarsitektur target (`file` → aarch64), bukan binary host;
- kernel di dalam `boot.img` identik dengan `Image.gz-dtb` yang dikirim, dan ramdisk memuat `/init`
  (dibuktikan dengan membongkar ulang image hasil).

## 4. Uji tanpa menulis apa pun

```bash
fastboot boot out/santoni/boot.img
./scripts/net/host-connect.sh                 # pasang 192.168.42.2/24 tanpa default gateway
ssh root@192.168.42.1                         # dropbear sudah jalan dari initramfs
```

Kalau gagal, bedakan dulu **kernel** vs **init** — inilah gunanya `panic=5` di cmdline:
satu tes boot menambah `init=/nope`:

- perangkat reboot sendiri / kembali ke fastboot → kernel **sampai** userspace; salahnya di
  init/initramfs/gadget. Jangan salahkan kernel.
- perangkat gelap total dan diam → kernel berhenti sebelum userspace (DTB/PSCI/clock/layout image).

## 5. Flash

```bash
fastboot flash boot out/santoni/boot.img      # dari fastboot; lihat docs/04 soal offset lk2nd
```

Rootfs ke partisi data — dua pilihan:

- **rootfs sebagai image ext4** (paling mudah diulang): buat `userdata.img` dari tarball rootfs,
  lalu `fastboot flash userdata userdata.img`.
- **rootfs sebagai tarball + partisi ext4**: `mkfs.ext4 -O quota -L userdata /dev/...`, mount,
  `tar xzf rootfs.tar.gz -C <mnt>`, buat `/dev /proc /sys /tmp` (mode 1777 untuk `/tmp`).

Rootfs OpenWrt untuk jalur B **bukan** rootfs `armsr` mentah: pakai image buildroot/opkg untuk
target SoC-mu, atau rootfs OpenWrt yang sudah disesuaikan (paket + `/opt` vendor bila perlu).

## 6. Boot pertama: urutan yang biasa terjadi

Ekspektasi realistis pada kernel baru: bagian built-in naik (procd, USB, SSH, AP), sementara
modul dari rootfs (WiFi WCNSS, modem) bisa terlambat bind. Gejala khas: `No modems were found`
sekali, lalu beberapa menit kemudian up karena watchdog retry. **Baca log sebelum menyimpulkan
kernel rusak** (`logread`, `dmesg`, `cat /sys/kernel/debug/...`).

## 7. Verifikasi pasca-boot

```sh
uname -r                     # kernel yang benar-benar jalan
cat /etc/openwrt_release     # versi OpenWrt
df -h /                      # ukuran / membuktikan rootfs yang dipakai
ip addr show | grep 192.168.42
ubus call system board       # procd/ubus hidup
iw dev                       # AP naik (kalau WiFi sudah jalan)
```

Dari host: `./scripts/net/host-connect.sh --check` → rute ke `192.168.42.1` harus lewat netdev USB,
bukan lewat router rumah. Ini pengecekan yang paling sering menyelamatkan dari kesimpulan salah
"HP-nya mati".
