# Samsung Galaxy Z Flip3 5G (b2q / SM-F711B) — SM8350 — BELUM BOOT

Status jujur: **belum pernah ada mainline Linux yang boot di perangkat ini.** Wiki pmOS untuk
`samsung-b2q` masih "not booting, not started". Semua yang ada di direktori ini adalah
profil + DTS rintisan supaya build dan pengujian bisa berjalan bertahap.

## Aturan yang dipegang (permintaan pemilik perangkat)

1. **Tidak menulis partisi apa pun sebelum kernel mainline terbukti boot.**
   Urutannya: jalur A (chroot, nol flash) → build CI (nol flash) → uji boot dengan
   boot image yang bisa dikembalikan → baru rootfs OpenWrt ditulis ke `userdata`.
2. Setiap penulisan partisi hanya `boot` (atau `recovery`), **tidak pernah** `super`/`system`/
   `userdata`, dan hanya setelah `boot.img` asli disalin ke host + `md5sum -c` lolos.

## Fakta yang sudah diverifikasi (bukan ingatan)

| Hal | Bukti |
|---|---|
| SoC SM8350 didukung mainline | `arch/arm64/boot/dts/qcom/sm8350.dtsi` di upstream: `qcom,sm8350-ufshc`, `qcom,sm8350-qmp-ufs-phy`, `qcom,sm8350-usb-hs-phy`, `qcom,sm8350-tsens`, `qcom,sm8350-rpmhpd` |
| Simbol config ada | `PINCTRL_SM8350` (Kconfig.msm:556), `SM_GCC_8350` (drivers/clk/qcom/Kconfig:1780), `QCOM_RPMH`, `QCOM_RPMHPD`, `SCSI_UFS_QCOM`, `PHY_QCOM_QMP_UFS/USB`, `REGULATOR_QCOM_RPMH` |
| lk2nd tidak bisa dipakai | pohon `ivoszbg/uniLoader`/lk2nd: dukungan device hanya sampai MSM8996; tidak ada SM8350 |
| uniLoader bisa dipakai | `board/Kconfig` punya SoC `SM8350` (board Motorola Edge 30 Fusion), dan `board/samsung/board-r0q.c` (S22) jadi cetakan |
| WiFi belum siap | mainline `ath11k` baru punya `ATH11K_HW_WCN6855_HW20/HW21`; **hw1.1 tidak ada** — perlu seri tambalan Baryshkov (sama seperti OnePlus 9 Pro) |
| Modem/LTE tidak realistis | port S22 SM8450: "no sm8450 IPA in mainline"; b2q memakai IPA/IPCR Samsung |
| Boot image stok | deviceinfo port Halium b2q: `base 0x0`, `kernel_offset 0x8000`, `ramdisk_offset 0x01000000`, `header_version 3`, dtbo terpisah (`b2q_eur_openx_w00_r08.dtbo`) |

## Bahan yang dipakai

- DTS: `dts/sm8350-samsung-b2q.dts` — salinan DTS rintisan dari `yurnam/linux-zflip3`
  (belum pernah dilaporkan boot). Isinya sudah: regulator RPMH pm8350/pm8350b/pm8350c/pmk8350/
  pmr735a/pmr735b, `uart2` console, UFS (`ufs_mem_hc`/`ufs_mem_phy`), USB (`usb_1` +
  `dr_mode = "peripheral"`), simple-framebuffer.
- Nilai pinctrl/regulator pembanding: dump DT downstream `b2q_eur_openx_w00_r12.dts` (16k baris)
  di repo `yurnam/linux-zflip3/downstream-dts/`.
- Loader: `uniloader/board-b2q.c` + `uniloader/b2q_defconfig` (nilai entry masih TODO).

## Rencana bertahap

1. **Jalur A — buktikan OpenWrt bisa boot tanpa flash** (`docs/02-jalur-a-chroot.md`):
   rootfs OpenWrt arm64 dijalankan di atas X-ROM yang sudah ber-root (KernelSU). Yang dibuktikan:
   `procd`/`ubus`/`netifd` hidup, LuCI mendengarkan, dnsmasq membagi DHCP, config hotspot valid.
   Yang **tidak** bisa dibuktikan di sini: AP WiFi (wlan0 dipegang Android) dan kmod apa pun.
2. **Build CI** (`build-kernel.yml -f device=b2q`): membuktikan fragment config mendarat di
   `.config` dan DTS perangkat benar-benar dikompilasi jadi DTB. Nol risiko.
3. **Uji boot** (butuh izin eksplisit, satu partisi saja): uniLoader berisi Image+DTB+initramfs
   ditulis ke `boot`; `recovery` **tidak disentuh** — di sana ada TWRP (terbukti: ramdisk
   partisi recovery memuat `twres/` + `twrp_ramdisk-timestamp`), jadi jalur pulih selalu ada:
   `VolUp` → TWRP → restore `boot.img` asli. Salinan restore sudah ditaruh **di perangkat**
   (`/sdcard/b2q-backup/boot.img` + `recovery.img`, md5 diverifikasi di HP) supaya pemulihan
   tidak bergantung pada host. Lapis kedua: tarball Odin `images/boot.tar` + `recovery.tar`.
4. **Rootfs OpenWrt** ke `userdata` (UFS 3.1, image sector **4096**) baru setelah langkah 3
   menunjukkan `lsusb` gadget hidup.
5. **WiFi**: verifikasi chip dulu (`lspci`, `dmesg | grep -i qcacld` di X-ROM), lalu tambalan
   ath11k hw1.1, baru AP/STA.

## Yang wajib diukur sebelum langkah 3

```sh
# di HP yang hidup (root via KernelSU), tidak menulis apa pun
ls -l /dev/block/by-name/ | grep -E 'boot|recovery|userdata|dtbo|vbmeta'
cat /proc/cmdline
zcat /proc/config.gz 2>/dev/null | grep -E 'CONFIG_(PID_NS|NET_NS|NF_TABLES|USER_NS)='
lspci -nn | head            # ID chip WiFi (WCN6855 hw1.1 vs hw2.x)
dmesg | grep -iE 'ath11k|qcacld|ufs|sector' | head -30
```
Pulih kalau eksperimen gagal: `dd` `boot.img` asli kembali ke `boot` dari TWRP, atau flash
firmware stok X-ROM lewat Odin. Backup wajib: `boot`, `dtbo`, `vbmeta`, `super` (kalau ada
ruang), `efs`/`persist`.