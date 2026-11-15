# LTE data di rolex (msm8917, mainline 7.1.3) — resep yang terbukti

Status: **data seluler LTE jalan** (ping + DNS + HTTP lewat `wwan0`), SIM XL, OpenWrt 24.10.5,
kernel `7.1.3` dari `msm89x7-mainline/linux`, ModemManager 1.22 / qmicli 1.34.

## Urutan yang harus benar

1. **Rootfs 24.10.5** (bukan 23.05). Di 24.10 semua paket modem ada di feed
   (`libqmi` 1.34, `libqrtr-glib`, `libmbim`, `modemmanager` 1.22, `qmi-utils`).
   ModemManager **< 1.22 tidak kenal QRTR**, jadi 23.05 buta modem internal ini.
2. **`rmtfs` + `libqrtr.so`**. `rmtfs` adalah binari sendiri (bukan paket OpenWrt) dan butuh
   `libqrtr.so` di rootfs. Tanpa itu modem *stall*:
   `qcom-q6v5-mss: fatal error received: dog.c:1522:Watchdog detects stalled initialization`
   dan QMI menjawab `Internal`.
3. **`/dev/disk/by-partlabel/*` harus ada** dan menunjuk **eMMC** (`mmcblk1*` di kernel ini, bukan
   mmcblk0 yang bisa jadi SD). `rmtfs -o /dev/disk/by-partlabel` membaca EFS lewat nama itu.
4. **Modul**: `qcom_q6v5` → `qcom_q6v5_mss` → `qcom_bam_dmux` → `rpmsg_wwan_ctrl`.
   Pakai `modprobe -a`, lalu jatuh ke `insmod` dengan path glob; verifikasi lewat munculnya
   `/sys/class/remoteproc/remoteproc1`. (Pakai `find`+insmod pernah gagal senyap saat boot:
   "insmod: failed to insert (null)".)
5. **UIM provisioning session harus diaktifkan manual.** Firmware tidak melakukannya sendiri:
   `Card state: present` tapi `Application state: detected` dan `AT+CPIN?` = `SIM busy`.
   ```
   qmicli -d qrtr://0 --uim-change-provisioning-session="slot=1,activate=yes,\
   session-type=primary-gw-provisioning,aid=$AID"
   ```
   (AID diambil dari `--uim-get-card-status`, blok `usim (2)`.) Setelah itu `Application state: ready`,
   `PIN1 state: disabled`, `+CPIN: READY`.
6. **Registrasi**: `AT+CFUN=1` (default CFUN 0 = RF mati) — dan **verifikasi** dengan `AT+CFUN?`
   karena tulis ke `/dev/wwan0at0` bisa hilang kalau port belum siap. Pemicu registrasi yang andal
   di firmware ini: `qmicli --nas-set-system-selection-preference="automatic"`.
   `AT+COPS=0` justru menjawab `ERROR`.
7. **Data call (bam-dmux)**: `--dpm-open-port` membuat `wwan0`, lalu **wajib**
   `Bind Mux Data Port` (ep-type bam-dmux) **di klien QMI yang sama** dengan `Start Network`.
   Tanpa bind: `QMI protocol error (70): InvalidOperation`. Klien WDS harus **tetap terbuka**;
   socket ditutup = call dibatalkan.
   qmicli hanya boleh satu aksi WDS per proses → dipakai `tools/rolex/rolex-qmi.c`
   (mode `up`: bind → set ip family → start → tahan klien → cetak IPv4/GW/MASK/DNS).
8. **Pasang IP**: `ip addr add <IPv4>/<pfx> dev wwan0`, route default via GW, `/etc/resolv.conf`
   dari DNS operator (112.215.198.248/254 untuk XL).

## Berkas yang bekerja

| Berkas | Peran |
|---|---|
| `rootfs/overlay/etc/init.d/rolex-modem` | firmware dari partisi `modem`, by-partlabel, rmtfs, modul + retry, start MSS |
| `rootfs/overlay/etc/init.d/rolex-lte` | procd: jalankan `rolex-lte-run` (respawn) |
| `rootfs/overlay/usr/bin/rolex-lte-run` | sesi UIM, RF, registrasi, dpm-open-port, data call, pasang IP |
| `tools/rolex/rolex-qmi.c` | QMI langsung lewat QRTR: `uim`, `data`, `up` (tanpa libqmi) |
| `tools/rolex/build-rootfs-2410.sh` | rakit rootfs 24.10.5 + paket modem (+ `libqrtr.so`, `rolex-qmi`) |

## Yang belum

- Rootfs masih di partisi **cache** (initramfs memilih ext4 berisi `/sbin/init`). Kalau Android
  di-format/di-boot dan cache dibersihkan, rootfs OpenWrt hilang → perlu tata letak partisi khusus.
- ModemManager 1.22 belum dipakai untuk data (masih "Failed to find a net port": tanpa udev,
  port `wwan0` tidak tergabung dengan port QRTR). Data jalan lewat jalur qmicli + `rolex-qmi`.
- Panggilan suara/SMS belum disentuh.
