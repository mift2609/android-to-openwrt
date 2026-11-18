# Tuning hotspot harian rolex

Diterapkan 2026-11-18 pada perangkat dan di `rootfs/overlay/`. Sasaran: rolex dipakai
sebagai hotspot portabel harian — LTE masuk lewat `wwan0`, klien lewat WiFi `phy0-ap0`
(`192.168.43.1`) atau USB `usb0` (`192.168.42.1`).

## WiFi (`/etc/config/wireless`)

| Opsi | Nilai | Alasan |
|---|---|---|
| `channel` | `11` | 2.4 GHz kanal 11 (HT40- → sekunder kanal 7), di luar kanal 1/6 yang paling padat |
| `htmode` | `HT40` | 40 MHz: throughput ~2x untuk klien dekat; kalau lingkungan sangat padat, turunkan ke `HT20` |
| `country` + `ieee80211d` | `ID`, `1` | batas daya/kanal sesuai regulasi Indonesia, beacon memakai info negara |
| `txpower` | `20` | daya wajar; jangan 30 — panas naik, tak menambah jangkauan nyata |
| `legacy_rates` | `0` | 802.11b (1/2/5.5/11 Mbit) dibuang: satu klien lambat memakan airtime seluruh sel |
| `ieee80211w` | `0` | PMF tidak diwajibkan supaya HP lama tetap bisa masuk |
| `disassoc_low_ack` | `0` | klien sinyal lemah tidak ditendang |
| `max_inactivity` | `86400` | bawaan 300 s membuat HP idle sering ke-drop lalu reconnect |

Verifikasi di perangkat: `grep -E "supported_rates|basic_rates|country_code|ht_capab" /var/run/hostapd-phy0.conf`
→ `supported_rates=60 90 120 180 240 360 480 540` (tanpa 10/20/55/110), `country_code=ID`.

## LTE

- `rolexlte.main` tetap: APN `internet`, `ipfam ipv4`, refresh 15 s, grace 60 s,
  restart setelah 2 kali gagal. Reconnect diurus `rolex-lte`, bukan `network restart`.
- MTU `wwan0` 1500 dan terbukti lewat (unduh 20 MB sukses tanpa fragmentasi).
- Ukur: `curl -o /dev/null -w "%{speed_download}\n" https://speed.cloudflare.com/__down?bytes=20000000`
  → ~1.4 MB/s (≈11 Mbit) pada sel XL saat uji; uji 5 MB hanya ~0.6 MB/s karena masih
  ramp-up, jadi selalu ukur dengan berkas ≥20 MB.
- `internet-detector`: interval naik 2 s → **15 s**, turun 10 s → **60 s**. Ping tiap 2 detik
  membuat radio LTE terus bangun (boros baterai/panas) tanpa manfaat; modul
  `network_restart`/`modem_restart`/`reboot` tetap **mati** karena bisa memutus `wwan0`
  yang dipasang manual.

## DNS

Klien → dnsmasq `:53` → AdGuard Home `127.0.0.1:5353` → DNS publik.
Dua upstream di dnsmasq: `127.0.0.1#5353` (AGH, penyaring iklan) + `94.140.14.14`
(cadangan, supaya internet tetap hidup kalau AGH mati).

Uji: `nslookup -type=A ads.doubleclick.net 192.168.43.1` → `0.0.0.0` (diblokir),
`nslookup -type=A openwrt.org 192.168.43.1` → IP asli.

## Firewall (`/etc/config/firewall`)

- `defaults.input` masih `ACCEPT` untuk zona `hotspot` — memang perlu (LuCI/ttyd/bandix
  diakses dari LAN).
- Zona `wan` diperketat: `input DROP`, `forward DROP`, `masq 1`. Bukti:
  `nft list chain inet fw4 drop_from_wan` → `iifname "wwan0" ... drop`.
- Hanya satu forwarding: `hotspot → wan`. Tidak ada NAT dobel.
- Penghitung rx/tx `wwan0` memakai tabel nft `netdev rolex_stat` (hook ingress/egress device
  `wwan0`), bukan iptables. Ini yang menghilangkan banner **"Legacy rules detected"** di
  Status > Firewall — banner itu muncul karena `iptables-save` masih memuat baris `-A`.

## CPU / jaringan (`/etc/rc.local`)

- governor `performance` (semua policy) — menghindari turun-frekuensi saat banyak klien.
  Kalau prioritasnya hemat baterai, ganti ke `schedutil`.
- `cubic` (satu-satunya CC non-reno di kernel ini), buffer TCP 4 MB, `tcp_fastopen=3`,
  `tcp_slow_start_after_idle=0`.
- `net.core.default_qdisc` **tidak ada** di kernel rolex (CONFIG_NET_SCH minimal, `tc`
  juga tidak terpasang) → fq/cake tidak bisa dipakai; jangan tambahkan sysctl itu.

## Layanan yang dimatikan autostart

`cloudflared`, `tailscale`, `rolex-debug`, `rolex-dash`, `radius` → `disable` + `stop`.
Paket dan menu LuCI tetap ada; nyalakan lagi dengan `/etc/init.d/<nama> enable`.

Sisa `rc.d` S*: sysfixtime, urngd, rolex-modules, boot, system, fstab, sysctl, log, rpcd,
rolex-usb, rolex-nft-modules, dbus, dnsmasq, dropbear, firewall, wpad, network,
packet_steering, odhcpd, cron, uhttpd, vnstat, modemmanager, ucitrack, adguardhome,
gpio_switch, done, rolex-modem, led, rolex-lte, internet-detector, sysntpd, bandix,
rolex-nat, ttyd, urandom_seed.

## Hasil uji

- WiFi: `phy0-ap0`, ssid `rolex-hotspot`, kanal 11 (2462 MHz) 40 MHz, txpower 20 dBm.
- LTE: `wwan0` `10.143.165.74/30`, ping 8.8.8.8 3/3 (RTT 33–96 ms), unduh 1.4 MB/s.
- Suhu setelah tuning: 48–54 °C, RAM terpakai ~160 MB dari 1.8 GB.
- `fw4 check` → `Ruleset passes nftables check.`

## Samba (share file untuk laptop + iPhone)

`luci-app-samba4` + `samba4-server` + `avahi-dbus-daemon` terpasang. Menu: **Services → Network Shares**.

| Setelan | Nilai |
|---|---|
| Share | `rolex` → `/srv/rolex` |
| User / sandi | `rolex` / `rolex12345` (user sistem uid 1000, dibuat lewat `smbpasswd`) |
| Interface | `usb wifi` → smbd hanya listen di `192.168.42.1:445` + `192.168.43.1:445` |
| Protokol | SMB2_02 ke atas (bawaan Samba 4.18) — iOS/macOS tidak lagi bisa SMB1 |
| Autostart | `S98samba4` |

**Storage**: share memakai root (`/dev/mmcblk1p49`, 23.9 GB, terpakai 569 MB) — tidak ada
partisi data terpisah. Ruang bebas 22 GB otomatis ikut ke share. Konsekuensi: isi share
**hilang saat sysupgrade** (hanya `/etc/config` yang disimpan). Kalau butuh data tahan
sysupgrade, backup manual (`tar` ke laptop) atau buat partisi data sendiri — itu butuh
resize partisi secara offline (risiko tinggi, lihat catatan di bawah).

**Dari laptop**
```
smbclient -L //192.168.42.1 -U rolex%rolex12345
# atau mount:
sudo mount -t cifs //192.168.42.1/rolex /mnt/rolex -o username=rolex,password=rolex12345,vers=3.0
```

**Dari iPhone**: Files → titik tiga → *Connect to Server* → `smb://192.168.43.1` →
*Registered User* → `rolex` / `rolex12345`. Kalau di jaringan WiFi rolex, share juga
diumumkan lewat mDNS (`/etc/avahi/services/smb.service`) sehingga muncul di *Shared*.

## Catatan soal "root 4 GB"

Root sekarang 23.9 GB dengan 569 MB terpakai. 4 GB memang cukup untuk sistem, **tapi
mengecilkannya tidak memberi keuntungan**: sisa 22 GB sudah jadi ruang bebas di root yang
sama, dan share Samba langsung memakainya. Resize partisi `userdata` (p49) harus dilakukan
saat partisi **tidak** ter-mount (boot initramfs/recovery) sambil menulis ulang GPT berisi
48 partisi bootloader/modem — risiko brick besar, manfaat nol. Jadi: tidak dilakukan.

## Kalau mau balik

Opsi WiFi lama: `legacy_rates 1`, tanpa `max_inactivity`/`disassoc_low_ack`.
`firewall`: zona `wan` `input REJECT`/`forward REJECT`. `internet-detector`:
`interval_up 2`, `interval_down 10`. `rc.local`: kosongkan isinya.
## Akses SMB dari luar rumah (belum diaktifkan)

SMB hanya di LAN (`smbd` bind `192.168.42.1:445` + `192.168.43.1:445`, WAN `input DROP`).
Kalau nanti butuh buka file dari jauh:

1. `tailscale` sudah terpasang di rolex, tapi **logout** dan autostart dimatikan saat tuning.
   `service tailscale enable && service tailscale start && tailscale up` → buka URL auth
   sekali dari HP, sesudah itu node masuk tailnet (LTE tetap bisa walau CGNAT, lewat DERP).
2. Samba masih bind ke device LAN saja. Ubah `/etc/samba/smb.conf.template`
   `bind interfaces only = yes` → `no` lalu `service samba4 restart`, supaya ikut listen
   di `tailscale0`. WAN tetap tertutup oleh firewall (`nft list chain inet fw4 drop_from_wan`),
   jadi ini tidak membuka SMB ke internet.
3. Akses: `smb://<ip-tailscale-rolex>` dengan user `rolex`.

Alternatif tanpa VPN: tarik file ke laptop lewat SSH (`scp`) saat sedang sejaringan.
