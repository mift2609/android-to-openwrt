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

- `panel` (`/usr/bin/panel`, sumber `tools/webpanel`) — dashboard ringan di `:8081`,
  punya init sendiri (`/etc/init.d/panel`). Tidak disentuh.
- `/www/index.html` tetap mengalihkan `/` ke LuCI.
- `/data/adb/modules/bfr_webui_go` di sisi Android (Magisk) tidak disentuh.
