#!/bin/sh
# deploy-rootfs.sh — pasang rootfs OpenWrt ke HP Android yang sudah root (jalur A).
#
# Pakai:
#   ./scripts/chroot/deploy-rootfs.sh --device mido --ssh root@192.168.42.1 --tarball out/rootfs/openwrt-24.10.5-armsr-armv8-rootfs.tar.gz
#   ./scripts/chroot/deploy-rootfs.sh --device mido --adb <serial> --tarball ...
#
# Yang dilakukan (semuanya di HP, tidak menyentuh partisi apa pun — Android tetap utuh):
#   1. cek sesi root + alat yang tersedia (tar, mount, unshare)
#   2. dorong tarball ke /data/local/tmp, ekstrak ke CHROOT_DIR
#   3. buat direktori sistem (/dev /proc /sys /tmp dengan mode benar)
#   4. pasang enter.sh + /etc/uci-defaults untuk konfigurasi awal (IP, SSH, LuCI)
#   5. verifikasi hasil: bin/busybox, /etc/openwrt_release, izin /tmp
#
# Catatan status: skrip ini TERUJI di host Linux (rootfs x86_64, lihat tests/smoke.sh)
# tetapi BELUM diuji end-to-end di HP Android oleh penulis repo. Kalau gagal, jalankan
# dengan `sh -x` dan laporkan langkah yang putus — bagian paling rawan adalah `tar`
# toybox (versi lama tidak mendukung -z; jatuh ke busybox Magisk otomatis).

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"

DEVICE=""; TARGET=""; TARBALL=""; DEST=""; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --device)  DEVICE=$2; shift 2 ;;
    --ssh)     TARGET="ssh:$2"; shift 2 ;;
    --adb)     TARGET="adb:$2"; ADB_SERIAL=$2; shift 2 ;;
    --tarball) TARBALL=$2; shift 2 ;;
    --dest)    DEST=$2; shift 2 ;;
    --keep)    KEEP=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done
[ -n "$TARBALL" ] || die "--tarball wajib (lihat scripts/openwrt/fetch-rootfs.sh)"
[ -f "$TARBALL" ] || die "tarball tidak ada: $TARBALL"
[ -n "$TARGET" ]  || die "pilih --ssh root@IP atau --adb <serial> (adb: jalankan 'adb root' dulu)"

if [ -n "$DEVICE" ]; then load_device; DEST=${DEST:-$CHROOT_DIR}; else
  DEST=${DEST:-/data/local/openwrt}; log "tanpa --device: pakai CHROOT_DIR default $DEST"
fi

# --- dorong berkas ke rootfs milik root --------------------------------------
# `adb push` menulis sebagai user 'shell' (non-root), sedangkan /data/local/openwrt dimiliki
# root -> push langsung gagal dengan "Permission denied". Jadi: dorong ke /data/local/tmp
# (world-writable), lalu pindahkan sebagai root.
push_as_root() {  # <lokal> <remote>
  _tmp="/data/local/tmp/.push.$$.$(basename "$2")"
  push_to_device "$1" "$_tmp" || die "push ke $_tmp gagal"
  run_on_device "mv -f '$_tmp' '$2'" || die "pindah ke $2 gagal (root?)"
}

assert_device_root

# --- 1. alat di perangkat -----------------------------------------------------
log "cek alat di perangkat"
run_on_device 'for c in tar mount unshare; do printf "%s=%s " $c "$(command -v $c || echo -)"; done; echo' || true
if ! run_on_device 'command -v tar >/dev/null' ; then
  die "tar tidak ada di perangkat. Pasang busybox (Magisk) lalu ulangi, atau ekstrak manual via TWRP."
fi

# --- 2. dorong + ekstrak ------------------------------------------------------
REMOTE_TGZ="/data/local/tmp/openwrt-rootfs.tar.gz"
log "dorong $(basename "$TARBALL") ($(mib_of "$TARBALL") MiB) -> $REMOTE_TGZ"
push_to_device "$TARBALL" "$REMOTE_TGZ"

# BusyBox/busybox tar, BUKAN toybox: toybox tar MENOLAK membuat symlink absolut yang
# mengarah keluar dir ekstraksi (rootfs OpenWrt penuh symlink seperti /etc/TZ -> /tmp/TZ),
# lalu berhenti dengan "not under ..." — ekstraksi menggantung setengah jalan.
# Magisk membawa busybox di /data/adb/magisk/busybox.
log "ekstrak ke $DEST (perangkat, busybox tar kalau ada)"
case "$DEST" in /data/*) : ;; *) die "DEST harus di bawah /data (dapat: $DEST)" ;; esac
run_on_device "
set -e
if [ -x /data/adb/magisk/busybox ]; then TAR='/data/adb/magisk/busybox tar'; else TAR=tar; fi
# rendisi bersih: tar toybox yang menemukan berkas lama di dir tujuan berhenti dengan error
if [ -e '$DEST/bin/busybox' ] || [ -e '$DEST/etc/openwrt_release' ]; then
  # WAJIB umount dulu: sisa mount /proc /sys /dev dari sesi enter.sh sebelumnya membuat
  # 'rm -rf' gagal dengan 'Operation not permitted' pada setiap entri.
  [ -x '$DEST/enter.sh' ] && sh '$DEST/enter.sh' --umount >/dev/null 2>&1 || true
  for m in dev/pts dev sys proc; do umount -l '$DEST/'\$m 2>/dev/null || true; done
  rm -rf '$DEST'
fi
mkdir -p '$DEST'
cd '$DEST' && \$TAR -xzf '$REMOTE_TGZ'
echo '[ok] ekstraksi selesai'
"

# --- 3. direktori sistem ------------------------------------------------------
log "siapkan direktori sistem (procd mati senyap kalau ini tidak ada)"
run_on_device "
set -e
mkdir -p '$DEST/dev' '$DEST/proc' '$DEST/sys' '$DEST/mnt' '$DEST/srv' '$DEST/tmp' '$DEST/dev/pts'
chmod 755 '$DEST/dev' '$DEST/proc' '$DEST/sys' '$DEST/mnt' '$DEST/srv'
chmod 1777 '$DEST/tmp'
"

# --- 4. enter.sh + konfigurasi awal ------------------------------------------
ENTER_SRC="$(repo_root)/scripts/chroot/enter.sh"
if [ -f "$ENTER_SRC" ]; then
  log "pasang enter.sh"
  push_as_root "$ENTER_SRC" "$DEST/enter.sh"
  run_on_device "chmod 755 '$DEST/enter.sh'"
fi

log "tulis konfigurasi awal OpenWrt (hostname, IP, izin SSH/LuCI dari LAN)"
# /etc/config/system dan /etc/config/network TIDAK ada di dalam tarball rootfs armsr:
# keduanya dibuat saat boot pertama oleh /bin/config_generate (dipanggil procd). Di jalur A
# tanpa procd berkas itu tidak pernah lahir, dan setiap `uci get` menjawab "Entry not found"
# — bukan karena rootfs rusak. Jadi jalankan eksplisit, lalu set nilainya lewat UCI.
log "bikin /etc/config/system + network (config_generate)"
run_on_device "chroot '$DEST' /bin/sh -c 'export PATH=/usr/sbin:/usr/bin:/sbin:/bin; [ -f /etc/config/system ] || /bin/config_generate >/dev/null 2>&1; echo config_generate=\$?'"
run_on_device "chroot '$DEST' /bin/sh -c 'export PATH=/usr/sbin:/usr/bin:/sbin:/bin; uci -q set system.@system[0].hostname='${HOSTNAME_OVERRIDE:-b2q-openwrt}' ; uci -q set system.@system[0].timezone='WIB-7'; uci -q commit system; uci -q set network.lan.ipaddr='${LAN_IP:-192.168.44.1}'; uci -q set network.lan.netmask='255.255.255.0'; uci -q commit network; echo -n hostname=; uci -q get system.@system[0].hostname; echo -n \" lanip=\"; uci -q get network.lan.ipaddr'"
UD="$DEST/etc/uci-defaults/99-android-openwrt"
printf '%s\n' '#!/bin/sh' > /tmp/99-android-openwrt
{
  echo "uci set system.@system[0].hostname='${HOSTNAME_OVERRIDE:-android-openwrt}'"
  echo "uci set system.@system[0].timezone='WIB-7'"
  echo "uci commit system"
  echo "uci set dropbear.@dropbear[0].Interface='lan' 2>/dev/null || true"
  echo "uci set dropbear.@dropbear[0].RootPasswordAuth='on' 2>/dev/null || true"
  echo "uci set uhttpd.main.listen_http='0.0.0.0:80' 2>/dev/null || true"
  echo "uci commit dropbear 2>/dev/null || true"
  echo "uci commit uhttpd 2>/dev/null || true"
  echo "/etc/init.d/dropbear enable 2>/dev/null || true"
  echo "/etc/init.d/uhttpd enable 2>/dev/null || true"
  echo "exit 0"
} >> /tmp/99-android-openwrt
push_as_root /tmp/99-android-openwrt "$UD"
run_on_device "chmod 755 '$UD'"

[ "$KEEP" = 1 ] || run_on_device "rm -f '$REMOTE_TGZ'"

# --- 5. verifikasi hasil ------------------------------------------------------
log "verifikasi hasil di perangkat"
run_on_device "
set -e
test -x '$DEST/bin/busybox' || { echo '[x] bin/busybox tidak ada/tidak executable'; exit 1; }
echo -n 'openwrt_release: '; grep -h DISTRIB_DESCRIPTION '$DEST/etc/openwrt_release' 2>/dev/null || echo '(tidak ada)'
echo -n 'izin /tmp: '; ls -ld '$DEST/tmp' | awk '{print \$1}'
echo -n 'versi busybox (chroot): '; chroot '$DEST' /bin/busybox 2>/dev/null | head -1
"

echo
ok "rootfs terpasang di $DEST"
cat <<EOF

Masuk ke OpenWrt:
  ssh ${TARGET#ssh:} 'sh $DEST/enter.sh'                  # shell
  ssh ${TARGET#ssh:} 'sh $DEST/enter.sh --services'       # layanan inti tanpa procd
  ssh ${TARGET#ssh:} 'sh $DEST/enter.sh --init'           # procd penuh (butuh PID namespace)
  ssh ${TARGET#ssh:} 'sh $DEST/enter.sh --umount'

Langkah berikutnya (NAT/uplink saat dipakai sebagai router): docs/02 + docs/05.
EOF
