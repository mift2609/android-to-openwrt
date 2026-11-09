# Xiaomi Redmi 4A (rolex) — MSM8917 — belum diuji di perangkat

Contoh nyata cara repo ini dipakai untuk **perangkat Qualcomm selain mido**. Profil ini
dibuat dengan:

```bash
./scripts/devices/new-device.sh --name rolex --soc msm8917 --codename rolex
```

yang otomatis memverifikasi lewat GitHub API:

| Yang diverifikasi | Hasil |
|---|---|
| keluarga SoC di `socs/qualcomm-soc-family.conf` | `msm8917` → `msm89x7-mainline/linux` |
| repo kernel + ref | `msm89x7-mainline/linux` default branch `msm89x7/7.1.3`, tag `v7.1.3-r1` ada |
| DTS untuk codename | `arch/arm64/boot/dts/qcom/msm8917-xiaomi-rolex.dts` |
| DTB dibangun oleh `make dtbs` | terdaftar di `dts/qcom/Makefile` → `msm8917-xiaomi-rolex.dtb` |
| bootloader lk2nd | `msm89x7-mainline/lk2nd` ada, entri `rolex` ada di `lk2nd/device/dts/msm8952/msm8917-xiaomi-common.dts` |

**Yang TIDAK bisa diverifikasi dari jarak jauh** (dan karena itu `device.conf` masih berisi TODO):
`MKBOOTIMG_ARGS`, `KERNEL_CMDLINE`, nama partisi, dan offset lk2nd. Semuanya harus dibaca dari
perangkat fisik:

```bash
./scripts/devices/probe-device.sh --device rolex --boot-img boot-stok.img --update-profile
```

## Catatan khusus perangkat ini

- **lk2nd wajib**, bukan opsional. Dokumentasi komunitas menyebut tanpa lk2nd kernel mainline
  tidak memilih panel yang benar → layar hitam meski kernel hidup. Entri `rolex` di lk2nd juga
  memuat tiga varian panel (BOE HX8394-F, EBBG ILI9881C, EBBG NT35521s).
- **Fastboot**: matikan perangkat, tahan **Vol Down + Power** sambil menancapkan USB.
- **Target kernel**: pmOS untuk perangkat ini berada di keluarga generik `qcom-msm89x7`
  (kernel 6.15 saat catatan ini ditulis); tag di `device.conf` (`v7.1.3-r1`) adalah tag rilis
  terbaru di repo fork-nya. Naik/turun tag = build ulang, dan modul harus ikut diperbarui di rootfs.
- **Modem**: butuh langkah manual di keluarga MSM8917. Untuk router, uplink WiFi/USB tethering
  biasanya lebih penting daripada modem internal.

## Checklist

1. [ ] probe → isi `MKBOOTIMG_ARGS`, `KERNEL_CMDLINE`, partisi, offset
2. [ ] backup partisi stok + simpan `lk2nd` di host (jalur pulang) — `docs/04`
3. [ ] `fastboot flash boot lk2nd-msm8917.img` (dari fastboot stok)
4. [ ] `gh workflow run build-kernel.yml -f device=rolex` → `boot.img`
5. [ ] `fastboot boot boot.img` (uji tanpa menulis) → baru `fastboot flash boot boot.img`
6. [ ] pasang rootfs ke partisi data, boot, lalu cek `uname -r`, `ip addr`, SSH, LuCI

Kalau ada langkah yang gagal, tulis temuanmu di sini (bagian "Hasil uji") — supaya profil ini
naik status dari "belum diuji" menjadi "terbukti", sebagaimana `devices/mido`.
