#!/bin/bash
# build-rootfs-2410.sh — rootfs rolex dari TAR RESMI OpenWrt 24.10.5 (basis sama dengan mido),
# plus ModemManager 1.22 + libqmi 1.34 + libqrtr-glib dari feed 24.10 (MM <1.22 tidak kenal QRTR).
set -euo pipefail
ROOT=/home/qiiin/rolex-openwrt
TAR=$ROOT/work/owrt-24.10.5-armsr-armv8-rootfs.tar.gz
OUT=$ROOT/work/rootfs-2410
IPK=$ROOT/work/ipk2410
INST=/home/qiiin/android-to-openwrt/scripts/tools/install-ipk-into-rootfs.py
MODSRC=${MODSRC:-$ROOT/out-artifact/modules-rolex-v7.1.3-r1}
KREL=$(basename "$(ls -d "$MODSRC"/*/ 2>/dev/null | head -1)") 
SIZE=240M

[ -f "$TAR" ] || { echo "[x] tar tidak ada: $TAR"; exit 1; }
echo "[*] ekstrak $TAR"
rm -rf "$OUT"; mkdir -p "$OUT"
tar xzf "$TAR" -C "$OUT"
[ -x "$OUT/sbin/init" ] || { echo "[x] sbin/init tidak ada"; exit 1; }

echo "[*] overlay perangkat"
cp -a "$ROOT/overlay-rolex/." "$OUT/" 2>/dev/null || true
cp -a /home/qiiin/android-to-openwrt/rootfs/overlay/. "$OUT/" 2>/dev/null || true
mv -f "$OUT/init" "$OUT/root/init.pivot-lama" 2>/dev/null || true

echo "[*] paket 24.10 (MM 1.22 + libqmi 1.34)"
FILES=$(ls "$IPK"/*.ipk | grep -v 'ppp_')
python3 "$INST" "$OUT" $FILES | tail -3

echo "[*] firmware WCNSS"
mkdir -p "$OUT/lib/firmware/wlan/prima"
cp -a "$ROOT/firmware/image/." "$OUT/lib/firmware/" 2>/dev/null || true
cp -a "$ROOT/firmware/prima/." "$OUT/lib/firmware/" 2>/dev/null || true
cp -a "$ROOT/firmware/prima/." "$OUT/lib/firmware/wlan/prima/" 2>/dev/null || true

echo "[*] modul kernel $KREL + depmod"
rm -rf "$OUT/lib/modules"; mkdir -p "$OUT/lib/modules"
cp -a "$MODSRC/$KREL" "$OUT/lib/modules/"
depmod -b "$OUT" "$KREL"

echo "[*] rmtfs (qcom-svc) + tool qmi sendiri"
install -m 0755 "$ROOT/work/qcom-svc/out/rmtfs" "$OUT/usr/bin/rmtfs"
install -m 0755 "$ROOT/work/rolex-qmi" "$OUT/usr/bin/rolex-qmi" 2>/dev/null || true

echo "[*] rc.d"
mkdir -p "$OUT/etc/rc.d"
for s in rolex-usb:15 rolex-wifi:94 rolex-debug:95 rolex-modem:60 dbus:19 modemmanager:61 network:20 dropbear:19 dnsmasq:19 firewall:19 uhttpd:50 rpcd:12; do
  n=${s%%:*}; l=${s##*:}
  [ -f "$OUT/etc/init.d/$n" ] && ln -sf "../init.d/$n" "$OUT/etc/rc.d/S${l}$n"
done

echo "[*] verifikasi"
for f in sbin/init usr/sbin/ModemManager usr/bin/qmicli usr/bin/mmcli usr/lib/libqmi-glib.so.5 \
         usr/bin/rmtfs etc/init.d/rolex-modem lib/modules/$KREL/kernel/drivers/net/wwan/wwan.ko; do
  [ -e "$OUT/$f" ] && echo "  [ok] $f" || echo "  [!] HILANG: $f"
done

echo "[*] image ext4 $SIZE"
IMG=$ROOT/work/rootfs-rolex-2410.ext4
truncate -s "$SIZE" "$IMG"
mke2fs -t ext4 -F -q -d "$OUT" -L OpenWrt "$IMG"
e2fsck -fy "$IMG" >/dev/null 2>&1 || true
gzip -9 -c "$IMG" > "$IMG.gz"
ls -lh "$IMG" "$IMG.gz"
md5sum "$IMG"