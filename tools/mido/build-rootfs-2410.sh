#!/bin/bash
# build-rootfs-2410.sh (mido) — rakit rootfs mido dari TAR RESMI OpenWrt 24.10.5 (armsr/armv8),
# meniru tools/rolex/build-rootfs-2410.sh tapi jalur diperbaiki (dulu ROOT salah).
#
# Bahan yang harus ada lebih dulu:
#   - TAR   : openwrt-24.10.5-armsr-armv8-rootfs.tar.gz  (unduh dari downloads.openwrt.org)
#   - MODSRC: dir hasil artefak CI `modules-mido-<tag>` (berisi <krel>/lib/modules/...)
#   - IPK   : dir *.ipk (opsional) — feed 24.10 (modemmanager/libqmi/dst) + paket kita
#             (tema-qiiin, luci-solo, samba-share, hotspot-tuning, modem-lte-mido)
#
# Pakai:
#   MODSRC=~/rolex-openwrt/out-artifact/modules-mido-v6.19.5-r0 \
#   IPK=~/rolex-openwrt/work/ipk2410 ./tools/mido/build-rootfs-2410.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${OUT:-$REPO/out/mido}
TAR=${TAR:-$OUT/owrt-24.10.5-armsr-armv8-rootfs.tar.gz}
MODSRC=${MODSRC:-}
IPK=${IPK:-}
FIRMWARE=${FIRMWARE:-}
SIZE=${SIZE:-320M}
ROOTFS=$OUT/rootfs
INST=$REPO/scripts/tools/install-ipk-into-rootfs.py
IB=$OUT/openwrt-imagebuilder-24.10.5-armsr-armv8.Linux-x86_64
# Paket dasar: LuCI + ModemManager (pengganti /opt/mm) + samba/avahi (samba-share)
PKGS=${PKGS:-"luci luci-ssl uhttpd rpcd rpcd-mod-luci modemmanager libqmi libmbim libqrtr-glib usbutils block-mount samba4-server avahi-dbus-daemon"}

# TAR = tar rootfs HASIL ImageBuilder (bukan tar polos: tar polos tak punya LuCI/uhttpd/rpcd).
# Dibuat sekali di sini supaya dependensi kmod/lib diurus ImageBuilder, bukan tangan.
if [ ! -f "$TAR" ]; then
	[ -d "$IB" ] || { echo "[x] ImageBuilder belum ada: $IB"; exit 1; }
	echo "[*] base rootfs via ImageBuilder: $PKGS"
	rm -rf "$OUT/ib-bin"
	( cd "$IB" && mkdir -p tmp && make image PACKAGES="$PKGS" \
		ROOTFS_PARTSIZE=320 BIN_DIR="$OUT/ib-bin" >/dev/null )
	src=$(ls "$OUT"/ib-bin/*rootfs.tar.gz 2>/dev/null | head -1)
	[ -n "$src" ] || { echo "[x] rootfs.tar.gz tak dihasilkan"; exit 1; }
	cp -f "$src" "$TAR"
fi

echo "[*] ekstrak $TAR"
rm -rf "$ROOTFS"; mkdir -p "$ROOTFS"
tar xzf "$TAR" -C "$ROOTFS"
[ -x "$ROOTFS/sbin/init" ] || { echo "[x] sbin/init tidak ada"; exit 1; }

echo "[*] overlay perangkat devices/mido/overlay"
cp -a "$REPO/devices/mido/overlay/." "$ROOTFS/"

# /init (pivot lama) tak dipakai jalur mainline -> simpan sebagai bukti
mv -f "$ROOTFS/init" "$ROOTFS/root/init.pivot-lama" 2>/dev/null || true

if [ -n "$IPK" ] && ls "$IPK"/*.ipk >/dev/null 2>&1; then
	echo "[*] pasang paket dari $IPK"
	# buang ppp_ (bentrok dengan modul kernel mido)
	python3 "$INST" "$ROOTFS" $(ls "$IPK"/*.ipk | grep -v 'ppp_') | tail -3
fi

if [ -n "$FIRMWARE" ] && [ -d "$FIRMWARE" ]; then
	echo "[*] firmware WCNSS: $FIRMWARE"
	mkdir -p "$ROOTFS/lib/firmware/wlan/prima"
	cp -a "$FIRMWARE/." "$ROOTFS/lib/firmware/" 2>/dev/null || true
	cp -a "$FIRMWARE/prima/." "$ROOTFS/lib/firmware/wlan/prima/" 2>/dev/null || true
fi

if [ -n "$MODSRC" ]; then
	KREL=$(basename "$(ls -d "$MODSRC"/*/ 2>/dev/null | head -1)")
	[ -n "$KREL" ] || { echo "[x] MODSRC kosong: $MODSRC"; exit 1; }
	echo "[*] modul kernel $KREL + depmod"
	rm -rf "$ROOTFS/lib/modules"; mkdir -p "$ROOTFS/lib/modules"
	cp -a "$MODSRC/$KREL" "$ROOTFS/lib/modules/"
	depmod -b "$ROOTFS" "$KREL"
fi

echo "[*] rc.d (enable init mido)"
mkdir -p "$ROOTFS/etc/rc.d"
# paket bisa sudah memasang symlink sendiri (modemmanager: S70) -> buang dulu, hindari start dobel
for n in modemmanager dbus uhttpd rpcd network dnsmasq firewall dropbear; do
	rm -f "$ROOTFS"/etc/rc.d/[SK]??"$n"
done
for s in mido-early:10 mido-usb:15 wpad:19 dbus:19 dropbear:19 dnsmasq:19 firewall:19 network:20 modemmanager:61 mido-modem:90 mido-data:92 mido-watchdog:93 mido-wifi:94 mido-debug:95 uhttpd:50 rpcd:12; do
	n=${s%%:*}; l=${s##*:}
	[ -f "$ROOTFS/etc/init.d/$n" ] && ln -sf "../init.d/$n" "$ROOTFS/etc/rc.d/S${l}$n"
done

echo "[*] verifikasi"
for f in sbin/init etc/init.d/mido-modem etc/init.d/mido-data etc/init.d/mido-watchdog \
         usr/bin/timeout usr/libexec/rpcd/mido3g etc/config/modem; do
	[ -e "$ROOTFS/$f" ] && echo "  [ok] $f" || echo "  [!] HILANG: $f"
done

echo "[*] image ext4 $SIZE"
IMG=$OUT/rootfs-mido-2410.ext4
truncate -s "$SIZE" "$IMG"
mke2fs -t ext4 -F -q -d "$ROOTFS" -L OpenWrt "$IMG"
e2fsck -fy "$IMG" >/dev/null 2>&1 || true
gzip -9 -c "$IMG" > "$IMG.gz"
ls -lh "$IMG" "$IMG.gz"
md5sum "$IMG"
