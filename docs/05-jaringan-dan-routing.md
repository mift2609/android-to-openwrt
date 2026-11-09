# 05 — Jaringan: gadget USB, NAT, AP, dan uplink

Tujuan akhirnya: HP jadi router — klien masuk lewat WiFi (AP) atau kabel/USB, keluar lewat uplink
(tethering WiFi, modem LTE, atau USB Ethernet).

## 1. Aturan alamat yang menghindari 90% "kok tidak nyambung"

- IP perangkat: **192.168.42.1/24** — jangan 192.168.1.1. Hampir semua router rumah memakai
  192.168.1.0/24; kalau sama, host akan mengirim paket ke router rumah, bukan ke HP.
- IP host di USB: **192.168.42.2/24 dengan `never-default yes`** — tanpa default gateway lewat USB.
  Ini yang membuat laptopmu tetap punya internet saat HP belum punya uplink.
- `./scripts/net/host-connect.sh` melakukan keduanya dan **membuktikannya** dengan
  `ip route get 192.168.42.1` (harus lewat netdev USB, bukan `wlp*`).

Verifikasi wajib, bukan opsional:

```bash
lsusb | grep -i '1d6b:'          # gadget configfs = Linux Foundation, BUKAN VID Xiaomi/Qualcomm
ip -o link show                  # netdev usb0/rndis0/enx* ada?
ip route get 192.168.42.1        # harus dev enx... (USB), bukan wlan
ping -c1 192.168.42.1
```

`ping` yang berhasil **bukan** bukti gadget hidup: bisa dijawab router rumahmu. Cek rutenya.

## 2. Gadget USB (RNDIS + ECM)

File yang dipakai: `rootfs/initramfs/init` (initramfs) dan `rootfs/overlay/etc/init.d/S15usb`
(procd). Keduanya melakukan hal sama: configfs → `idVendor 0x1d6b`, dua fungsi (`rndis.usb0` untuk
Windows, `ecm.usb0` untuk Linux/macOS), lalu bind ke `/sys/class/udc`.

Hal-hal yang menentukan berhasil/gagal:

- **PHY USB harus built-in**, bukan modul (`CONFIG_PHY_QCOM_QUSB2=y`) — kalau `=m`, `dwc3` sering
  gagal probe sebelum modul dimuat dan `/sys/class/udc` tetap kosong.
- **`/sys/class/udc` muncul asinkron** (PHY probe): tunggu sampai ~15 s dengan poll sebelum menyerah.
- **`dr_mode`** di DTB: `otg` tidak selalu mengaktifkan gadget di semua SoC; `peripheral` lebih pasti.
  (Di repo kernel MSM8953 saat ini DTS mido sudah `peripheral`; kalau tag-mu masih `otg`, ubah
  lewat `patches/dtb/` alih-alih mengedit DTB biner dengan tangan.)
- **Entry USB pertama harus konfigurasi gadget**, sebelum hal non-esensial seperti console:
  init yang menunggu `/dev/tty0` bisa mati sebelum USB pernah muncul → perangkat tampak "mati total".

## 3. DHCP, DNS, dan NAT di OpenWrt

```sh
# di perangkat (UCI = sumber kebenaran)
uci set network.lan.proto='static'
uci set network.lan.ipaddr='192.168.42.1'
uci set dhcp.lan=dhcp
uci set dhcp.lan.interface='lan'
uci set dhcp.lan.start='100'; uci set dhcp.lan.limit='150'
uci set dhcp.lan.leasetime='12h'
uci set dhcp.lan.dhcpv6='disabled'; uci set dhcp.lan.ra='disabled'

# zona firewall: lan -> wan masquerade (firewall4/nftables)
uci set firewall.@zone[1].name='wan'
uci set firewall.@zone[1].masq='1'
uci set firewall.@zone[0].network='lan'
uci commit; /etc/init.d/network restart; /etc/init.d/firewall restart; /etc/init.d/dnsmasq restart
```

Uplink (pilih salah satu):

- **Tethering WiFi dari HP lain / hotspot**: `uci set wireless.@wifi-iface[0].mode='sta'` lalu
  sambungkan sebagai klien; interface itu masuk zona `wan`. Ini skenario paling praktis untuk
  membuktikan routing sebelum menyentuh modem.
- **Modem LTE internal**: butuh `ModemManager`/`rmnet` + watchdog retry (lihat catatan urutan di
  `devices/mido/README.md`). Jangan mulai dari sini.
- **USB Ethernet (jika SoC mendukung host mode)**: dhcp client di interface itu, masuk zona `wan`.

## 4. AP WiFi

```sh
uci set wireless.radio0.disabled='0'
uci set wireless.radio0.country='ID'
uci set wireless.default_radio0.ssid='mido-hotspot'
uci set wireless.default_radio0.encryption='psk2'
uci set wireless.default_radio0.key='ganti-sandi-ini'
uci set wireless.default_radio0.mode='ap'
uci commit wireless; wifi reload
```

- Naikkan urutan start AP (`START=17` atau sejenis) kalau AP kadang kosong saat boot: itu urutan
  boot, bukan kelambatan firmware.
- Jangan `rmmod` modul WLAN di sistem yang hidup — hang.
- Cek: `iw dev` (interface + SSID), `logread | grep hostapd`.

## 5. Rantai verifikasi saat "sudah kelihatan jalan tapi tidak ada internet"

```sh
# di perangkat
ip -4 addr show                     # IP lan + wan
ip route                            # ada default route via wan?
ping -c1 1.1.1.1                    # uplink jalan? (IP bukan nama)
nslookup openwrt.org                # DNS jalan?
nft list ruleset | grep -i masquerade
cat /proc/sys/net/ipv4/ip_forward   # harus 1

# di klien
ip route get 1.1.1.1                # lewat HP?
```
Urutannya: link → IP → route → forward → NAT → DNS. Berhenti di langkah pertama yang gagal; jangan
menebak di tengah rantai.
