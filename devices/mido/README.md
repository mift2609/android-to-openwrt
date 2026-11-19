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

## Rakit rootfs sendiri (`tools/mido/build-rootfs-2410.sh`)

Base = **ImageBuilder** 24.10.5 (armsr/armv8) dengan paket dasar LuCI + ModemManager feed
+ `qmi-utils` + samba/avahi; lalu overlay `devices/mido/overlay`, firmware dari perangkat,
`rmtfs` statik (`out/mido/bin/rmtfs`), modul kernel, dan ipk sendiri.

```sh
cd ~/repos/android-to-openwrt
# 1. base + paket (sekali; hasil: out/mido/owrt-24.10.5-armsr-armv8-rootfs.tar.gz)
./tools/mido/build-rootfs-2410.sh            # TAR belum ada -> ImageBuilder otomatis
# 2. image lengkap
MODSRC=$PWD/out/mido/modules-live \
FIRMWARE=$PWD/out/mido/firmware \
IPK=$PWD/out/mido/ipk SIZE=640M ./tools/mido/build-rootfs-2410.sh
```

**Modul kernel WAJIB cocok `uname -r`.** Perangkat ini berjalan
`6.19.5-postmarketos-qcom-msm8953`, jadi `devices/mido/device.conf` menyetel
`KERNEL_LOCALVERSION="-postmarketos-qcom-msm8953"`. Tanpa itu modul CI bernama `6.19.5`
dan menolak dimuat (`version magic ... should be ...`) -> WiFi/LTE mati.
`out/mido/modules-live` = salinan `/lib/modules` dari perangkat (pasti cocok).

## Menulis image ke perangkat

Partisi rootfs = `userdata` (`/dev/mmcblk0p49`, 1.4 GB). Image 640 MB; setelah boot pertama
jalankan `resize2fs /dev/mmcblk0p49` supaya sisa partisi terpakai.

1. Reboot ke lk2nd (fastboot): `reboot` lalu pilih *fastboot* di menu lk2nd (atau `adb reboot bootloader`).
2. Dari laptop:
   ```sh
   gunzip -c rootfs-mido-2410.ext4.gz > rootfs-mido-2410.ext4
   fastboot flash userdata rootfs-mido-2410.ext4
   fastboot reboot
   ```
3. Setelah hidup: LuCI `http://192.168.26.1/` (USB) atau `http://192.168.27.1/` (WiFi
   `mido-hotspot`). Sandi root belum diset -> LuCI minta dibuat saat login pertama.

Kernel tidak perlu ditulis ulang selama `uname -r` tetap `6.19.5-postmarketos-qcom-msm8953`.

## Catatan kernel: `ipa2-lite`, bukan `ipa`

Kernel yang **berjalan** di perangkat memakai modul `drivers/net/ipa2-lite/ipa2-lite.ko`
(driver IPA varian MSM8953), sedangkan build CI dari `msm8953-mainline/linux` tag yang sama
menghasilkan `drivers/net/ipa/ipa.ko`. Artinya `.config` kernel perangkat **belum** sama dengan
`devices/mido/kernel.config.fragment` (perlu `CONFIG_IPA2_LITE` + tambalan IPA2). Selama belum
diperbaiki: **jangan tulis boot.img hasil CI**, dan untuk rootfs pakai `MODSRC=out/mido/modules-live`
(salinan `/lib/modules` perangkat) supaya modem tetap hidup.

## LTE: ModemManager 1.24 bundle `/opt/mm` (bukan MM feed)

MM feed 24.10 (1.22) di image ini **gagal**: `couldn't create modem for device
'qcom-soc': Failed to find a net port in the QMI modem` -> modem dibuang, LTE mati.
Diperbaiki dengan bundle Alpine yang sama seperti rootfs lama:

- `/opt/mm` (MM 1.24.2 + eudev + polkitd + libs), diambil dari zip backup
  `mido-openwrt-6.19.5.zip` -> `rootfs.tar.gz` (`./opt/mm`).
- eudev (`/opt/mm/sbin/udevd`, S61) mengisi `/run/udev/data`; tanpa DB udev MM tak
  melihat net port. Rules `etc/udev/rules.d/99-mido-netport.rules` menandai
  `rmnet_ipa0`/`qmapmux*` sebagai `ID_MM_QCOM_SOC` + `ID_MM_PORT_TYPE_NET`.
- polkitd dibutuhkan MM 1.24 untuk `--enable`/connect; rule `00-allow-all.rules`
  memberi YES. Symlink `/usr/share/polkit-1` + `/usr/lib/polkit-1` -> `/opt/mm/...`.
- User `polkitd` (uid 999) ditambahkan ke `/etc/passwd` dan `/etc/group`.
- Plugin dibaca dari `/usr/lib/ModemManager` -> symlink ke `/opt/mm/usr/lib/ModemManager`.
- rc.d: `S61udev-alpine` lalu `S91modemmanager` (dbus S19).

Bundle tidak di-commit (9,5 MB biner). Rakit ulang butuh:

```sh
# dari zip backup: unzip -> tar xzf rootfs.tar.gz ./opt/mm ... (lihat tools/mido)
ls out/mido/mm-bundle.tgz    # isi: opt/mm + init.d/{udev-alpine,modemmanager}
```

Tanpa bundle, skrip build mencetak peringatan; LTE tak akan hidup.

## Firewall (fw4)

NAT/MSS sepenuhnya di fw4: zone `hotspot` (usb+wifi) -> zone `wan` (`list device qmapmux0.0`, input/forward DROP, masq+mtu_fix). Tak ada lagi `table ip mido` dari `mido-data`.

Modul nft (`nft_ct`, `nft_reject_inet`, `nft_fib_inet`) tak termuat otomatis karena `ipv6.ko` adalah modul dan kmodloader tak mengurutkannya. `/etc/init.d/nft-modules` (S15) melakukan insmod eksplisit sebelum fw4 (S19). Tanpa itu fw4 gagal render: `Error: No such file or directory` pada `ct state vmap` / `reject`.

## OpenClash (semua mode)

- Paket `luci-app-openclash_0.47.024_all.ipk` = versi dari image HG680P (DE6.2), dirakit ulang dari daftar berkas paket di image itu; `Depends` `kmod-tun` dibuang; core `clash_meta` (`alpha-gbeb1f27`) ikut di dalam ipk. Disimpan di `out/mido/ipk/`.
- Kernel wajib punya `NFT_TPROXY`, `NFT_SOCKET`, `NFT_REDIR`, `NETFILTER_XT_TARGET_TPROXY`, `NETFILTER_XT_MATCH_SOCKET` (workflow `mift2609/mido-openwrt-kernel`, tag `v6.19.5-r0`). Tanpa `NFT_REDIR`, mode redir-host gagal (`nft ... redirect`: `No such file or directory`).
- Modul tproxy/socket (`nf_tproxy_ipv4/6`, `nf_socket_ipv4/6`, `nft_tproxy`, `nft_socket`, `xt_TPROXY`) dimuat `/etc/init.d/nft-modules` (S15); `ipv6.ko` harus lebih dulu.
- Default `en_mode='redir-host'` (tproxy TCP `redirect:7892` + UDP `tproxy:7895`), `stack_type='system'`. `fake-ip-tun` juga terbukti jalan; TUN built-in (`/dev/net/tun`) walau tak ada `tun.ko`.
- `check_mod "tun"` di `/etc/init.d/openclash` (0.47) gagal karena `tun` built-in tanpa modul: overlay menambal satu baris (`[ -c /dev/net/tun ] && return 0`).
- `config_path` bawaan `/etc/openclash/config/reyre.yaml`. Isi bawaannya **template** (`server: domain/ip`, `sni: domain`, `path: /path`) di `/etc/openclash/proxy_provider/account-{1,2}.yaml`; isi node/subscription asli lewat LuCI sebelum dipakai.
- Bug ACL (0.47 & 0.48): chain `openclash`/`openclash_mangle` merujuk set ACL tanpa syarat, jadi set harus ada. Dipakai `lan_ac_mode='1'` + `lan_ac_white_ips` = subnet LAN (26/27) + satu MAC dummy di `lan_ac_white_macs`, dan `common_ports='1'`; tanpa itu rantai berhenti sebelum `redirect`/`tproxy` dan klien tidak diproksi.
- `boot.img` di `out/mido/` = kernel CI (Oct-30 build tidak punya redir) + initramfs p21 yang terbukti boot; `out/mido/modules-live/` harus dari artefak CI yang sama.
- DNS: klien -> dnsmasq `:53` -> AdGuard Home `:5353` (filter) -> clash `127.0.0.1:7874` (fake-ip). `enable_redirect_dns='2'` (firewall redirect) supaya DNS liar dari klien tetap dibajak.
- Config contoh tanpa node: `/etc/openclash/config/test.yaml` (`MATCH,DIRECT`). Ganti lewat LuCI (Config File / Subscription) untuk proxy sungguhan.
- Start: `/etc/init.d/openclash start` (S99). Butuh `luci-compat`, `ruby`, `ruby-yaml`, `dnsmasq-full`, `ip-full`, `bash`, `ca-bundle`, `unzip`.
