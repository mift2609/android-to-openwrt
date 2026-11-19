# devices/mido/overlay — setelan perangkat mido (gaya rolex)

Isi overlay ini = yang dipakai mido saat ini, dirapikan agar **reproducible** dan tanpa rahasia
(repo ini PUBLIK).

| Jalur | Isi |
|---|---|
| `etc/init.d/mido-*` | urutan bring-up: `mido-early` → `mido-usb` → `mido-modem` → `mido-data` → `mido-watchdog` → `mido-wifi` |
| `etc/config/*` | network/wireless/dhcp/firewall/system/modem/uhttpd/luci |
| `usr/bin/timeout` | pengganti applet busybox yang HILANG di image ini (sama seperti rolex) |
| `usr/libexec/rpcd/mido3g` | backend LuCI panel Modem Manager & Lock Band |
| `usr/share/{luci/menu.d,rpcd/acl.d}/luci-app-mido3g.json` | menu + hak akses panel |
| `www/luci-static/resources/view/mido3g/*` | UI panel (overview + lock band) |
| `www/index.html` | `/` → `/cgi-bin/luci/` |

## Perbedaan dari device asli
- `etc/config/modem`: kredensial operator (`username`/`password`) dan APN **dikosongkan**.
  Isi lewat LuCI; skrip jatuh ke APN `internet` bila kosong.
- `mido-data`/`mido-watchdog`: sudah membawa **jurus hardening rolex** — route `onlink`,
  koreksi alamat network, rotasi IP (`rotate_mins`), dan tangga pemulihan
  RF → MSS restart → reboot (`restart_after`, `reboot_after_mss`).

## Catatan
- `usr/bin/timeout` WAJIB ada: tanpa itu setiap `timeout N ...` di skrip gagal seketika
  (`timeout: not found`) dan tampak seperti perintahnya yang gagal.
- Modul kernel (`/lib/modules`) dan firmware WCNSS **tidak** di sini — ikut artefak CI kernel mido.
