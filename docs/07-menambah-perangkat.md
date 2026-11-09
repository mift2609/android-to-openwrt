# 07 — Menambah perangkat baru (HP Qualcomm apa pun)

Tiga hal menentukan apakah sebuah HP Qualcomm bisa masuk repo ini sebagai profil, dan hanya dua
yang bisa diperiksa dari jarak jauh:

| Syarat | Bisa diperiksa dari jauh? | Cara |
|---|---|---|
| SoC-nya punya fork kernel mainline | ya | tabel `socs/qualcomm-soc-family.conf` + GitHub API |
| DTS perangkat ada di fork itu | ya | `new-device.sh` mencari nama codename di `arch/arm64/boot/dts/qcom` |
| bootloader bisa di-unlock & lk2nd tersedia | ya (repo ada) / tidak (unlock-nya harus kamu lakukan) | repo lk2nd platform, kebijakan vendor |
| argumen mkbootimg, partisi, offset lk2nd | **tidak** | harus dibaca dari perangkat (`probe-device.sh`) |

## 1. Kenali SoC dan codename-nya

```bash
adb shell getprop ro.board.platform      # msm8953, msm8917, sdm660, ...
adb shell getprop ro.product.device      # codename (mido, rolex, santoni, ...)
```
Tanpa adb: buka Recovery/Info perangkat, atau cocokkan model dengan wiki komunitas. Nama codename
harus sama dengan yang dipakai kernel (biasanya tercermin di nama file DTS).

## 2. Buat profil (dengan verifikasi otomatis)

```bash
./scripts/devices/new-device.sh --list                                  # keluarga SoC yang didukung
./scripts/devices/new-device.sh --name santoni --soc msm8953 --codename santoni
```

Skrip itu akan berhenti dengan pesan jelas kalau:
- SoC tidak ada di tabel → kamu perlu menambahkan keluarga SoC-nya (lihat §6),
- tag/branch kernel tidak ada → dengan daftar tag terbaru,
- DTS dengan codename itu tidak ada → perangkat ini **belum didukung mainline**; itu pekerjaan
  porting DTS (§7), bukan sekadar menambah profil,
- DTS ada tapi tidak terdaftar di `Makefile` → `make dtbs` tidak akan menghasilkannya (tambahkan
  sendiri di fork/patch-mu).

Profil yang dihasilkan: `device.conf` (dengan nilai terverifikasi + TODO yang harus diukur),
`kernel.config.fragment` (kerangka syarat minimum router), dan `README.md` dengan checklist.

## 3. Ukur nilai yang tidak bisa ditebak

```bash
./scripts/devices/probe-device.sh --device santoni --boot-img boot-stok.img --update-profile
```
- ambil `boot-stok.img` dari firmware resmi (fastboot ROM) — jangan dari perangkat yang sudah
  dimodifikasi;
- skrip menulis `MKBOOTIMG_ARGS` + `KERNEL_CMDLINE` yang benar ke `device.conf`, dan melaporkan
  bootloader mana yang menjawab fastboot;
- `--pull-boot` bisa menarik partisi boot dari perangkat ber-root (hasilnya **dump arsip**, bukan
  artefak flash — lihat docs/04).

## 4. Sesuaikan fragment config untuk SoC-mu

Kerangka dari `new-device.sh` sudah memuat syarat minimum (VA 48-bit, USB gadget, nftables,
filesystem, console). Yang perlu kamu tambahkan **spesifik SoC** adalah clock + interconnect:

| Keluarga | Clock | Interconnect |
|---|---|---|
| MSM8953 | `CONFIG_MSM_GCC_8953=y` | `CONFIG_INTERCONNECT_QCOM_MSM8953=y` |
| MSM8917 (keluarga msm89x7) | `CONFIG_MSM_GCC_8917=y` | `CONFIG_INTERCONNECT_QCOM_MSM8916=y` |
| MSM8916/8939 | `CONFIG_MSM_GCC_8916=y` | `CONFIG_INTERCONNECT_QCOM_MSM8916=y` |

Nama pastinya ada di `drivers/clk/qcom/Kconfig` dan `drivers/interconnect/qcom/Kconfig` pada
repo kernel yang kamu pakai — periksa di sana, jangan percaya tabel ini buta. Lalu buktikan:

```bash
./scripts/build/apply-config-fragment.sh --tree out/<device>/src --fragment devices/<device>/kernel.config.fragment
```
Skrip itu gagal dengan pesan tepat kalau ada simbol yang salah nama atau tidak mendarat di `.config`.

## 5. lk2nd, DTS, dan firmware — bagian yang bikin perangkat "hampir jalan"

- **lk2nd**: sebagian besar perangkat Qualcomm butuh ini (di beberapa perangkat wajib, mis. karena
  pemilihan panel). Bangun dari repo lk2nd platformnya, flash dari fastboot stok ke partisi `boot`.
- **Firmware WiFi/BT**: ekstrak dari partisi `modem`/`persist` perangkat stok
  (`wcnss.mdt`, `*.b00-b12`, `WCNSS_qcom_wlan_nv.bin`, `WCNSS_cfg.dat`) dan taruh di
  `/lib/firmware/` rootfs. Tanpa ini driver probe tapi tidak bisa mengirim paket.
- **Modem**: sama, butuh firmware + sering langkah manual; ekspektasi realistis: uplink LTE datang
  belakangan, WiFi/AP lebih dulu.

## 6. Menambah keluarga SoC ke tabel

Kalau SoC-mu belum ada di `socs/qualcomm-soc-family.conf`:

1. cari fork mainline-nya (biasanya `https://github.com/<soc>-mainline/linux`, turunan
   `msm8916-mainline/linux`), dan repo `lk2nd`-nya;
2. cek tag/branch terbaru dan pastikan DTS perangkatmu ada;
3. tambahkan satu baris (TAB sebagai pemisah), lalu verifikasi seluruh tabel:

```bash
./scripts/devices/new-device.sh --check-socs
```

## 7. Kalau DTS perangkatmu belum ada

Ini batas antara "menambah profil" dan "porting kernel". Port DTS butuh: skema hardware perangkat
(panel, sensor, PMIC), DTS perangkat lain di SoC yang sama sebagai acuan, `dtc` untuk memeriksa,
dan iterasi `fastboot boot` dengan `panic=5` untuk tiap perubahan. Perkirakan hitungan hari–minggu,
dan kontribusikan DTS-nya ke fork mainline supaya orang lain bisa memakai profilmu.

## 8. Menutup pekerjaan: naikkan status perangkat

`devices/mido/README.md` adalah contoh status "terbukti". Untuk perangkat baru, tulis apa yang
kamu **buktikan** (perintah + keluaran), bukan "kayaknya jalan". Kriteria yang dipakai repo ini:

- [ ] `fastboot boot boot.img` → perangkat sampai userspace (ada USB)
- [ ] SSH masuk + `uname -r` sesuai kernel yang dibangun
- [ ] `df -h /` menunjukkan rootfs yang benar
- [ ] DHCP memberi alamat ke klien
- [ ] uplink nyata (bukan hanya IP terpasang): `ping 1.1.1.1` dari klien
- [ ] AP WiFi muncul dan klien bisa tersambung
- [ ] set backup + panduan pemulihan ada dan terverifikasi md5
