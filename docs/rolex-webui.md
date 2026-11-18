# rolex-webui — dihapus dari perangkat

Dashboard Go "ROLEX WebUI" (`/usr/bin/rolex-webui`, paket opkg `rolex-webui` 0.1.0-r1,
Svelte + Go) sudah dibuang dari rolex pada 2026-11-18. Sebabnya: bindernya memaku `:80`
(hardcode) dan mati kalau `:80` sudah dipakai uhttpd, sehingga procd merespawn tiap ~5 s.
LuCI (uhttpd `:80`) sekarang antarmuka utama, jadi dashboard itu hanya jadi gangguan.

## Backup

`/home/qiiin/backups/rolex-webui-2026-11-18.tar.gz` (4.8 MB), isinya biner
`rolex-webui` + `rolex-webui-passwd`, `/etc/init.d/rolex-webui`, `/etc/config/rolex`,
`/etc/rolex-webui.json`, cert + kunci TLS, addon json, ACL rpcd, `/root/webui-run.sh`,
dan metadata opkg.

Disalin juga ke repositori **privat** `https://github.com/mift2609/rolex-backups`
(bukan repo publik ini — tar itu memuat kunci TLS privat, hash sandi, dan
`BFR_PASSWORD` telanjang).

## Memasang ulang

Tar itu berisi `rwui-bak/files/` yang persis mengikuti tata letak rootfs:

```sh
tar xzf /home/qiiin/backups/rolex-webui-2026-11-18.tar.gz -C /tmp
cp -a /tmp/rwui-bak/files/etc/. /etc/
cp -a /tmp/rwui-bak/files/usr/. /usr/
cp -a /tmp/rwui-bak/files/webui-run.sh /root/
/etc/init.d/rolex-webui enable
```

Karena `:80` dipakai LuCI, hentikan uhttpd dulu kalau ingin menjalankannya langsung:

```sh
/etc/init.d/uhttpd stop
/etc/init.d/rolex-webui start
```

`/root/webui-run.sh` menunjuk `/root/webui-linux` yang **tidak** ikut ter-backup
(biner itu sudah tidak ada di perangkat); pakai `/usr/bin/rolex-webui` langsung.

## Yang tetap ada

- `/www/index.html` tetap mengalihkan `/` ke LuCI.
- `/data/adb/modules/bfr_webui_go` di sisi Android (Magisk) tidak disentuh.

## panel (:8081) dan bfr-adapter (:8082) — juga dihapus

Dua dashboard non-LuCI lain dibuang pada 2026-11-18 supaya **hanya LuCI** yang jalan:

- `panel` — biner Go `tools/webpanel`, port 8081.
- `bfr-adapter` — adaptor BFR WEBUI `tools/bfr-adapter`, port 8082 (menerjemahkan API
  BFR ke data OpenWrt, memakai `panel.main.password`/`bfr_port` dari uci).

Keduanya dijalankan manual (bukan paket opkg): biner di `/usr/bin/`, init di
`/etc/init.d/`, symlink rc.d ditambahkan tangan, jadi sekarang symlink itu ikut dibuang
dan file init di overlay repo (`rootfs/overlay/etc/init.d/{panel,bfr-adapter}`) dihapus.

Backup: `/home/qiiin/backups/panel-bfr-2026-11-18.tar.gz` (kedua biner + init.d + keluaran
`uci show panel`), di repo privat yang sama. Sumbernya tetap ada di `tools/webpanel` dan
`tools/bfr-adapter`.

Sisa port setelah pembersihan: `:80` uhttpd (LuCI), `:22` dropbear, `:7681` ttyd,
`:8686` bandix, `:3000` AdGuard Home.

## Menu LuCI diringkas untuk hotspot harian

Menu bawaan penuh halaman yang tak dipakai saat rolex jadi hotspot portabel (Firewall/nftables,
Routing, Processes, Channel Analysis, Realtime, System Log, Release RAM, DHCP/DNS, Diagnostics,
Firewall config, Bandix, Net Detector, Scheduled Tasks, Mount Points, LED, Startup, Nikki,
OpenClash, Neko, Tailscale).

Yang disisakan:

| Grup | Halaman |
|---|---|
| Status | Overview |
| System | System, Administration (Router Password, SSH Access, HTTP(S) Access), Software, Backup / Flash Firmware, Reboot |
| Services | AdGuard Home, Terminal |
| Modem | Modem LTE |
| Network | Wireless |

Caranya: berkas `rootfs/overlay/usr/share/luci/menu.d/*.json` berisi versi ringkas
(menghapus entri dari JSON = menu **dan** route-nya hilang, jadi `/admin/status/nftables`
kini 404). Setelah mengubah menu, hapus cache: `rm -f /tmp/luci-indexcache*`.

Empat menu berasal dari controller Lua, bukan JSON — `openclash`, `neko`, `release_ram`,
`diskman` — dan disembunyikan dengan mengganti nama berkasnya menjadi
`*.lua.disabled` (lihat langkah di `tools/rolex/build-rootfs-2410.sh`). Pulihkan dengan
mengganti nama balik. Salinan asli semua `menu.d/*.json` ada di
`/home/qiiin/backups/menu-d-orig/`.

## 404 protocol/3g.js dan protocol/modemmanager.js

Halaman LuCI yang memuat model `network` (Overview, Network, System, Channel Analysis,
Release RAM, Net Detector) mencatat dua request 404: LuCI meminta
`protocol/<nama>.js` untuk **setiap** proto handler yang dilaporkan netifd, dan netifd
melaporkan `3g` + `modemmanager` karena `/lib/netifd/proto/{3g,modemmanager}.sh` ada
(paket `comgt` dan `modemmanager`), sedangkan paket JS LuCI-nya belum terpasang.

Perbaikan: pasang `luci-proto-3g` dan `luci-proto-modemmanager` (keduanya ada di feed
24.10.5, tidak menarik upgrade `luci-base`). Setelah itu `bad: []` di semua halaman.
Keduanya sudah masuk `devices/rolex/packages.txt`.
