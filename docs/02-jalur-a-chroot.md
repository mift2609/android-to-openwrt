# 02 — Jalur A: OpenWrt di dalam Android yang sudah ber-root

Inti jalur ini: rootfs OpenWrt resmi dijalankan di dalam Android, memakai kernel Android yang
sudah ada. Tidak ada partisi yang ditulis, tidak ada bootloader yang dibuka.

## A1 (disarankan): pakai runtime container yang sudah matang — Droidspaces

Ada proyek yang sudah menyelesaikan bagian tersulit dari jalur ini, dan lebih baik memakai milik
mereka daripada skrip sendiri:

- **[ravindu644/Droidspaces-OSS](https://github.com/ravindu644/Droidspaces-OSS)** — runtime
  container (mirip LXC) untuk Android/Linux, binary C musl statis untuk aarch64, lisensi GPL-3.0.
- **[latifangren/droidspaces-webui](https://github.com/latifangren/droidspaces-webui)** — daemon
  Go + UI web untuk mengelola container itu di HP (KernelSU/Magisk/APatch), termasuk
  **katalog rootfs sekali-klik** yang memuat **OpenWrt 24 (24.10.x)**.

Yang penting bagi kita: katalog OpenWrt-nya **otomatis menambal masalah khas Android** sesudah
rootfs diekstrak — grup socket Android (`inet` 3003, `net_raw` 3004, `net_admin` 3005), konfigurasi
DHCP interface, dan resolver DNS fallback. Ini tepat bagian yang bikin chroot OpenWrt "terlihat
jalan tapi tidak bisa buka socket" kalau dikerjakan manual. Ia juga mendeteksi init di dalam
rootfs dan bisa mengendalikan **procd** (start/stop/enable) serta menyediakan mode jaringan
NAT/Gateway/Host/Macvlan — "Gateway" = OpenWrt dipakai sebagai router internal untuk container lain.

Kalau kamu memakai Droidspaces, lewati A2 di bawah; kamu masih bisa memakai repo ini untuk
konfigurasi OpenWrt-nya (UCI, firewall, AP) dan untuk jalur B.

## A2: chroot minimal dari repo ini (tanpa aplikasi tambahan)

Pakai ini kalau kamu mau jalur A yang bisa diotomatiskan (CI, skrip, tanpa aplikasi GUI), atau
ingin tahu persis apa yang terjadi di level chroot.

```bash
# 1) di host: ambil rootfs OpenWrt arm64 resmi (target generik armsr/armv8) + verifikasi sha256
./scripts/openwrt/fetch-rootfs.sh --arch arm64 --release 24.10.5 --out out/rootfs
#    -> out/rootfs/openwrt-24.10.5-armsr-armv8-rootfs.tar.gz

# 2) dorong ke HP (harus root: 'adb root' atau SSH root) dan pasang
./scripts/chroot/deploy-rootfs.sh --device mido --ssh root@192.168.42.1 \
    --tarball out/rootfs/openwrt-24.10.5-armsr-armv8-rootfs.tar.gz

# 3) masuk
ssh root@192.168.42.1 'sh /data/local/openwrt/enter.sh'                # shell
ssh root@192.168.42.1 'sh /data/local/openwrt/enter.sh --services'     # layanan inti saja
ssh root@192.168.42.1 'sh /data/local/openwrt/enter.sh --init'         # procd sebagai PID 1
ssh root@192.168.42.1 'sh /data/local/openwrt/enter.sh --umount'       # lepas mount
```

`enter.sh` memilih mode berdasarkan kemampuan kernelmu: `--init` butuh **PID namespace**
(diuji nyata dengan `unshare --pid --fork true`, bukan hanya melihat `--help`). Kalau kernel
Android tidak punya PID namespace, `--services` menjalankan dnsmasq/dropbear/uhttpd langsung.

Mekanismenya sudah diuji di host Linux dengan rootfs OpenWrt resmi (x86_64, prosedur yang sama:
ekstrak → mount `proc`/`sys`/`/dev` → chroot): `DISTRIB_ID='OpenWrt'`, `opkg version`, `dnsmasq`
/`dropbear`/`uhttpd` ada, dan `procd` benar-benar naik sebagai PID 1 di dalam
`unshare --pid --fork --mount-proc`. Yang belum diuji adalah varian Android-nya (rootfs arm64 di
HP ber-root) — lihat catatan status di README.

### Konfigurasi awal setelah masuk

```sh
# di dalam shell OpenWrt
uci set system.@system[0].hostname='android-openwrt'
uci set network.lan.ipaddr='192.168.42.1'
uci set network.lan.netmask='255.255.255.0'
uci set dhcp.lan.interface='lan'
uci set dhcp.lan.start='100'; uci set dhcp.lan.limit='150'
uci commit
/etc/init.d/network restart    # (mode --init) atau: killall -HUP dnsmasq
```

Lalu: `opkg update && opkg install luci` bila ingin UI web, dan
`/etc/init.d/uhttpd start` (atau `--services` yang sudah menjalankannya).

## Syarat kernel di HP-mu — periksa SEBELUM repot (sering gagal di sini)

"Root" saja tidak cukup: yang menentukan adalah **flag kernel Android-mu**. Kernel bawaan vendor
sering dikirim tanpa `CONFIG_PID_NS`/`CONFIG_IPC_NS`, dan tanpa itu container/chroot berlapis
namespace **tidak bisa start sama sekali** (bukan sekadar fitur berkurang).

```sh
# di HP (root) — jalur A pakai kernel Android yang sudah ada
zcat /proc/config.gz 2>/dev/null | grep -E 'CONFIG_(PID_NS|IPC_NS|UTS_NS|NET_NS|USER_NS|CGROUPS|MEMCG)='
# kalau /proc/config.gz tidak ada, ambil dari kernel yang sedang jalan:
#   strings /dev/block/by-name/boot | grep -m1 'Linux version'
```

Kalau kamu memakai runtime container (Droidspaces dkk), biarkan alatnya yang memeriksa:
`droidspaces check --json` (atau Settings → Requirements) melaporkan MUST-HAVE / RECOMMENDED /
OPTIONAL. MUST-HAVE merah = jangan buang waktu; masalahnya kernel, bukan konfigurasi OpenWrt.

Konsekuensi praktis:

- **`PID_NS`/`IPC_NS` ada** → `enter.sh --init` (procd sebagai PID 1) atau runtime container bisa
  dipakai. Ini kasus yang enak.
- **Namespace tidak lengkap** → jalur A tinggal mode `--services`/`--shell` (tanpa procd sebagai
  PID 1), atau tidak jalan sama sekali. Menambah flag namespace berarti membangun kernel kustom
  (di kernel GKI 5.4+ wajib patch kABI, kalau tidak perangkat bootloop) — dan begitu kamu membangun
  kernel sendiri, jalur B (mainline) justru lebih masuk akal untuk router permanen.
- **Docker/Podman di dalam container** butuh rootfs berupa **image ext4 sparse**, karena `/data`
  di Android adalah F2FS dan driver `overlay2` tidak bisa hidup di sana. Untuk OpenWrt userspace
  biasa, rootfs mode direktori (yang dipakai skrip di repo ini) sudah cukup.
- Kalau memakai WebUI runtime container: **ganti sandi default sebelum mengeksposnya ke LAN** —
  daemon itu API dengan hak root.

## Batasan yang harus kamu terima (jujur, ini bukan bug)

1. **Kernel tetap kernel Android.** `opkg install kmod-*` tidak ada gunanya; modul kernel tidak
   bisa ditambahkan. Semua kemampuan jaringan ditentukan kernel itu (netfilter, nftables, TUN).
   Cek cepat: `ls /proc/net/ip_tables_names` (iptables) dan `nft list ruleset` (nftables).
2. **`firewall4` (default OpenWrt 24.10) butuh nftables.** Kalau kernel Android-mu hanya punya
   iptables legacy, pakai `firewall3`/aturan iptables manual — atau jalankan firewall di sisi
   Android.
3. **Izin socket.** Proses di dalam chroot mewarisi grup/domain SELinux dari proses Android yang
   meluncurkannya. Kalau layanan tidak bisa membuka socket padahal root, tambahkan grup Android
   ke rootfs: `echo 'inet:x:3003:root' >> /etc/group; echo 'net_raw:x:3004:root' >> /etc/group;
   echo 'net_admin:x:3005:root' >> /etc/group` (persis yang dilakukan katalog Droidspaces).
4. **Bukan sistem init.** Android tetap PID 1; chroot ini tamu. Untuk otomatis jalan saat boot,
   pakai service Magisk/KernelSU (post-fs-data / late_start) yang memanggil `enter.sh --services`.
5. **Reboot = mati.** Tidak ada persistensi otomatis; itu tugas service di poin 4.

## Verifikasi (jangan puas dengan "kelihatannya jalan")

```sh
# di dalam chroot
cat /etc/openwrt_release | head -2      # DISTRIB_ID / DESCRIPTION
ubus call system board | head -5        # hanya jalan kalau procd hidup (mode --init)
netstat -ltn | grep -E ':22|:80|:53'    # dropbear, uhttpd, dnsmasq mendengarkan
ip addr show                            # IP lan terpasang?
```

```bash
# di host
./scripts/net/host-connect.sh --check   # rute ke perangkat + ping, tanpa mengubah apa pun
```
