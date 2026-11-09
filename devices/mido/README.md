# Xiaomi Redmi Note 4X (mido) — MSM8953 — TERBUKTI JALAN

Perangkat referensi repo ini. Yang sudah dibuktikan di perangkat nyata (bukan dari dokumen):

| Komponen | Bukti |
|---|---|
| OpenWrt userspace | 24.10.5, `procd` + `ubus` + `netifd` jalan penuh dari initramfs/rootfs |
| Kernel mainline | `6.19.5-postmarketos-qcom-msm8953` (keluarga repo `msm8953-mainline/linux`) |
| Jaringan USB | gadget configfs RNDIS, terlihat di host sebagai `1d6b:* Linux Foundation` |
| Akses | SSH + LuCI (`root`/`root`) di `192.168.42.1`, AP WiFi `mido-hotspot` |
| Uplink | LTE via modem internal (setelah watchdog menunggu IPA/rmnet bind) |
| Suhu SoC | tampil di LuCI Status Overview (thermal_zone0/8) |

Catatan yang berlaku juga untuk perangkat lain di keluarga ini:

- **Partisi** (terukur di perangkat ini, hanya sebagai pembanding — perangkatmu bisa beda):
  `p21` = boot (64 MB, berisi lk2nd + kernel), `p22` = recovery, `p49` = userdata (rootfs OpenWrt).
- **lk2nd hidup di dalam partisi `boot`.** Karena itu:
  - image kernel ditulis pada offset 512 KiB (bukan 0) — `LK2ND_OFFSET_KIB=512`;
  - jangan pernah memakai menu "Install Image → Boot" ala TWRP: itu menulis di offset 0 dan
    menghapus lk2nd, setelah itu `aboot` stok tidak bisa boot kernel mainline;
  - dump partisi boot 64 MB **bukan** artefak yang bisa di-flash dengan `fastboot flash boot`
    (isinya akan bergeser 512 KiB). Yang boleh di-flash adalah `out/mido/boot.img` hasil
    `pack-bootimg.sh`.
- **Argumen mkbootimg** di `device.conf` berasal dari boot image yang sudah terbukti boot.
  Ganti salah satunya → bootloader tidak mengenali image.
- **`VA_BITS_52`**: defconfig platform punya ini sebagai default choice. Di Cortex-A53 itu
  mematikan boot dalam ~0,1 s tanpa log. Fragment di direktori ini memaksa 48-bit dan
  `apply-config-fragment.sh` membuktikannya (`CONFIG_ARM64_VA_BITS=48`).
- **Modem butuh kesabaran urutan**: pada kernel baru, driver IPA belum tentu bind saat
  ModemManager pertama jalan (`No modems were found`). Watchdog retry 60 s menyelesaikannya —
  baca log sebelum menyimpulkan kernel rusak.

## Kalau mau memakai profil ini untuk perangkat lain di keluarga MSM8953

Redmi 4X (`santoni`), Mi A1 (`tissot`), Redmi 5 (`vince`), Redmi Note 5 (`vince`): repo kernel,
lk2nd, dan strukturnya sama; yang berbeda hanya **DTB**, **argumen mkbootimg**, **partisi**, dan
**panel**. Buat profil baru, jangan mengedit profil ini:

```bash
./scripts/devices/new-device.sh --name santoni --soc msm8953 --codename santoni
./scripts/devices/probe-device.sh --device santoni --boot-img boot-stok-santoni.img --update-profile
```
