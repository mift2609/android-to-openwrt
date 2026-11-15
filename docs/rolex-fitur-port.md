# rolex — fitur hasil port dari image HG680P (DE6.2 … _wifi-off)

Sumber: `~/Downloads/DE6.2_HG680P_24.10.4_NCP_Paid_Version_wifi-off.img.xz` (OpenWrt 24.10.4,
armsr/armv8, rootfs **btrfs**, kernel flippy 6.6.113, 479 paket, brand `reyre`).
Arsitektur sama dengan rolex (aarch64_generic, musl, LuCI 24.10) → paketnya bisa dipindahkan.

## Cara port

1. Image di-mount (`losetup -Pf`, FAT `BOOT` + btrfs `ROOTFS`), lalu untuk tiap paket dibaca
   `/usr/lib/opkg/info/<paket>.list` → daftar berkas diekstrak dari mount, di-*tar*, dikirim ke rolex
   (`cat tar | ssh tar -C / -xf -`), plus metadata opkg (`info/*`, stanza `status` disalin).
2. Paket yang **ada** di feed resmi tapi unduhannya sering gagal di device: diunduh di laptop lalu
   `tar xzf data.tar.gz -C /` di rolex (`/tmp/install-ipks.sh`). Terbukti untuk `socat`,
   `luaposix`, `libuci-lua`, `libubus-lua`, `vnstat2`, `usbutils`, `lua-bit32`, `libsqlite3-0`, `usbids`.

## Yang sudah jalan di rolex

| Fitur | Menu LuCI | Status |
|---|---|---|
| **Bandix** — trafik per klien (web sendiri di `:8686`) | Network → Bandix | jalan; `iface=wlan0` |
| **Internet Detector** — auto-restart koneksi kalau internet mati | Modem → Net Detector | jalan; `iface=wwan0`, `config.mode=1` |
| **vnstat2** — statistik trafik harian/bulanan | (CLI/`vnstat`) | jalan; memantau `wwan0` + `wlan0` |
| **Crontab Wizard** — jadwal tugas dari GUI | System → Scheduled Tasks | terpasang |
| **Diskman** — partisi/mount dari GUI | System → Mount Points | terpasang (butuh `parted` ✓) |
| **Ramfree** — bebaskan RAM | Status → Overview | terpasang |
| **3ginfo-lite** — info 4G via AT | Modem → 4G Connection | menu terpasang; **belum berfungsi** (lihat batasan) |
| **sms-tool + LuCI** — SMS/USSD/AT dari GUI | Modem (views: readsms/sendsms/ussd/atcommands) | tool ada; **belum berfungsi** (lihat batasan) |
| **socat** + `atbridge` (pty `/dev/ttyAT0`) | — | terpasang, service **dimatikan** (lihat batasan) |
| **usbutils** (`usbreset`), `smartmontools`, `comgt`/`gcom` | — | terpasang |
| **ttyd** — terminal di browser | System → Terminal | jalan |

## Batasan SMS/3ginfo di rolex (penting)

1. Port AT rolex adalah **`/dev/wwan0at0`** dari `rpmsg-wwan` — karakter device (242:0), **bukan tty**.
   `sms_tool` dan `gcom` memakai `tcsetattr()` → gagal `Bad file descriptor`.
   Jalan pintas: `socat` membuat pty `/dev/ttyAT0` (service `atbridge`, START=93) — alat berbasis tty
   jadi bisa bicara, TAPI:
2. Saat sesi data aktif, perintah berbau SIM dijawab **`+CME ERROR: SIM busy`** (storage SIM terkunci
   oleh sesi data). Membaca SMS (`AT+CMGL`) praktis tidak bisa bersamaan dengan LTE aktif.
3. Menahan port AT dengan socat membuat `rolex-lte-run` gagal `AT+CFUN=1` → modem jatuh ke **CFUN=0
   (RF off, not-registered-searching)**. Karena itu `atbridge` **tidak diaktifkan** secara default;
   aktifkan hanya saat debugging (`/etc/init.d/atbridge start`), lalu reboot device setelahnya.
   Gejala CFUN=0 disembuhkan dengan reboot penuh.

Kesimpulan: SMS lewat LuCI belum bisa diandalkan di modem ini. Kalau nanti diperlukan, opsinya:
baca SMS **tanpa** membuka sesi data (stop `rolex-lte` sejenak), atau implementasi pembacaan SMS
sendiri lewat QMI (bukan AT).

### Gejala "port AT tidak ada"

`/dev/wwan0at0` bisa **hilang** (modem restart → driver melepas port, `dmesg`: `port wwan0at0
disconnected`). Kalau node-nya hilang, shell apa pun yang menulis ke path itu membuat **file biasa**
(`printf 'AT' > /dev/wwan0at0`), dan file itu lalu **menutupi** char device saat muncul kembali.
Jadi: `rm -f /dev/wwan0at0 /dev/wwan0at1` lalu restart modem/reboot. Setelah boot bersih node-nya
kembali sebagai char device `242:0` (+ `242:1`) dan raw read/write jalan.

## Halaman "4G Connection" (3ginfo-lite) disambungkan ke QMI

`luci-app-3ginfo-lite` meminta data ke `/usr/share/3ginfo-lite/3ginfo.sh json`, dan skrip itu
memakai `gcom`/AT → selalu gagal di rolex. Sekarang:

* `3ginfo.sh` asli disimpan sebagai `3ginfo.sh.orig`.
* `3ginfo.sh` baru = pembungkus: menjalankan `.orig` (untuk statistik koneksi: durasi, rx/tx —
  itu dibaca dari `/proc/net/dev`, jadi tetap benar), lalu nilai modem diambil dari
  `/usr/bin/rolex-3ginfo-json` (semuanya lewat `qmicli`/QMI + `mmcli -i` untuk SIM).
* Hasilnya: persen sinyal, operator + MCC/MNC, Cell ID/TAC, CSQ, RSSI/RSRP/RSRQ/SINR,
  Pita utama (`B1 (2100 MHz)`) + PCI/EARFCN, suhu, firmware, IMSI/ICCID/IMEI, durasi + rx/tx.

## Pilihan band (mudah) di halaman Modem LTE

Halaman `Modem → Modem LTE` sekarang punya **checkbox band** (bukan kolom teks `eutran-3`):
band LTE yang didukung modem dari QMI, dilabeli `B1 (2100 MHz)`, dan band operator Indonesia
diberi tanda ★. Tombol: **Terapkan pilihan**, **Band Indonesia (B1,B3,B5,B8,B40)**, **Auto (lepas lock)**.

Catatan teknis penting:

* ModemManager 1.22 (OpenWrt) menolak daftar band berpisah **koma** — harus **`|`**
  (`--set-current-bands="eutran-1|eutran-3"`). Helper `rolex-modem-ctl band` mengubah koma → `|`.
* Ganti band memutus sesi data → helper otomatis `rolex-lte restart` (IP kembali ~60–90 s).
* Band yang benar-benar didukung modem ini: `eutran-1,3,4,5,7,8,20,40,41` + 2G/3G. **B2 tidak ada**
  di firmware MSM8917 ini.

## DNS penyaring iklan: **AdGuard Home**

Image HG680P **tidak** punya adblock/AdGuard (hanya `dnsmasq-full`), jadi AGH diambil dari rilis
resmi (arm64 statis) dan dipasang manual:

* biner `/opt/AdGuardHome/AdGuardHome` (v0.107.80, 32 MB), config `/opt/AdGuardHome/AdGuardHome.yaml`,
  service `/etc/init.d/adguardhome` (procd, respawn, START=94), ikut diawasi `rolex-watchdog`.
* Alur DNS: klien LAN → **AGH :53** (filter iklan) → upstream **127.0.0.1:5353 = dnsmasq**
  (`dhcp.@dnsmasq[0].port=5353`, `listen_address=127.0.0.1`) yang tetap melayani DHCP + nama lokal.
* Panel web `http://192.168.42.1:3000` — user `admin`, sandi `rolex` (**ganti**). Helper
  `/usr/bin/rolex-adguard-ctl status|restart|update` + halaman LuCI **Modem → AdGuard Home**.
* Filter awal: AdGuard DNS filter + hostlist Indonesia → **192.055 aturan**; uji: `doubleclick.net`,
  `ads.doubleclick.net`, `googleadservices.com` → `0.0.0.0`.
* Jebakan: YAML v0.107 menolak `edns_client_subnet: []` (`cannot construct !!seq into
  dnsforward.EDNSClientSubnet`) — hapus baris itu, kalau tidak AGH crash loop.

## Proxy & tunnel

| Paket | Status | Catatan |
|---|---|---|
| **nikki + luci-app-nikki** (mihomo v1.19.15) | jalan | TUN/redirect bisa; **TPROXY tidak** — kernel rolex tanpa `CONFIG_NF_TPROXY`/`NFT_TPROXY`, jadi `kmod-nft-tproxy`/`kmod-nft-socket` tak bisa dimuat. Isi node dulu di Services → Nikki |
| **tailscale + luci-app-tailscale-community** | jalan (belum login) | TUN ✓; tinggal `tailscale up` |
| openclash, passwall | **tidak dipasang** | butuh `iptables`/`bash`/`ruby`, dan kernel rolex tanpa iptables |
| `luci-app-package-manager`, `curl`, `yq`, `ip-full`, `dnsmasq-full` | terpasang | dnsmasq-full = build dengan DHCP + DNSSEC + nftset |

Catatan ruang: root rolex sekarang di **`/dev/mmcblk1p49` (23.9 G, ext4)** — cukup untuk app besar
(AGH 32 MB + mihomo 30 MB + tailscale 23 MB masih lega).

Skrip porting ulang: `tools/port-from-image.py <paket...>` — menyelesaikan dependensi dari
`/usr/lib/opkg/info/*.control` di image, melewati `kmod-*` (modul kernel beda versi), membangun satu
tar berisi berkas + metadata opkg untuk diekstrak di rolex.

## Pelajaran jaringan klien (WiFi/LAN) — pernah bikin "tidak dapat IP" & "tanpa internet"

Tiga bug berbeda, jangan tertukar:

1. **DHCP mati karena nama interface tidak cocok.** Seksi DHCP menunjuk interface `lan`
   (bawaan OpenWrt), padahal rolex memakai `usb` dan `wifi`. Akibatnya dnsmasq **tidak
   menghasilkan `dhcp-range` sama sekali** dan tidak mendengar UDP/67 → klien asosiasi WiFi
   tapi tak pernah dapat IP, walau sinyal bagus. Perbaikan: seksi `dhcp usb` + `dhcp wifi`
   (lihat `rootfs/overlay/etc/config/dhcp`). Cek cepat: `grep dhcp-range /var/etc/dnsmasq.conf.*`
   dan `netstat -lnup | grep :67`.
   Di **mido** hal ini tidak terjadi karena nama interface-nya memang `lan` — itulah kenapa
   "di mido jalan".
2. **NAT tidak ada.** Kernel rolex belum punya NAT nftables (`type nat hook prerouting` ditolak)
   sehingga `fw4` gagal start dan ruleset kosong: router sendiri bisa internet, klien tidak.
   Sementara: `iptables-legacy` (xtables) + modul `iptable_nat` (ada di kernel) → service
   `/etc/init.d/rolex-nat` (MASQUERADE wwan0 + FORWARD usb0/wlan0 → wwan0), dijaga watchdog.
   Setelah kernel baru (NFT_NAT=m) fw4 bisa dipakai normal.
3. **AdGuard Home jangan memegang :53 untuk klien.** Dengan AGH di :53, iPhone "tersambung tapi
   tanpa internet" (gejala: dapat IP, kueri DNS nyaris tidak keluar) — terbukti dengan menghentikan
   AGH dan menjalankan dnsmasq di :53: internet langsung kembali. Susunan yang benar:
   **klien → dnsmasq :53 → AGH 127.0.0.1:5353 → DNS publik** (`noresolv 1`, `list server
   '127.0.0.1#5353'`). Penyaringan tetap jalan (uji: `ads.doubleclick.net` via `192.168.43.1`
   dijawab `0.0.0.0`/`::`).

Soal WiFi: AP di `rolex-hotspot` kini **WPA2-PSK** (sandi diatur `rolex-wifi-ctl key <sandi>`;
default `rolex12345`) — jaringan terbuka membuat iOS menandai "koneksi tidak aman". Tambahan
opsi ramah klien iOS di `rolex-wifi-ctl`: `wmm_enabled=1` (HT butuh WMM), `skip_inactivity_poll=1`
+ `ap_max_inactivity=1800` (dulu klien iOS terlihat `deauthenticated due to inactivity` tiap ~50 s),
`disassoc_low_ack=0`.

## Perbaikan lain dari sesi ini

* `rolex-lte-run`: kalau operator memberi alamat yang justru **network address** (mis. `10.147.178.64/30`,
  semua host bit nol) → prefix dinaikkan (`/31`) supaya paket bisa dikirim.
* `rolex-lte-run`: `modem_via_init()` — kalau MSS masih `offline`, dipanggil `rolex-modules` +
  `rolex-modem` (self-heal), pelengkap watchdog cron.
* `rolex-watchdog` (cron 2 menit): jaga MSS/LTE/AP + terapkan perubahan WiFi dari uci.
