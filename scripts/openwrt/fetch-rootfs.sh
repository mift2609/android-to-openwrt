#!/bin/sh
# fetch-rootfs.sh — unduh + verifikasi rootfs resmi OpenWrt (bukan rootfs Android apa pun).
#
# Pakai:
#   ./scripts/openwrt/fetch-rootfs.sh --arch arm64   --release 24.10.5 --out out/rootfs
#   ./scripts/openwrt/fetch-rootfs.sh --arch x86_64  --release 24.10.5 --out out/rootfs
#
# --arch arm64  -> target armsr/armv8  : rootfs generik arm64 (dipakai di HP Android arm64)
# --arch x86_64 -> target x86/64       : untuk uji di PC/laptop/VM (bukan untuk HP)
#
# Verifikasi yang dilakukan (bukan sekadar "unduhan selesai"):
#   1. sha256 dicocokkan dengan berkas `sha256sums` resmi dari server OpenWrt
#   2. tarball diuji (`tar tzf`) — arsip rusak/terpotong langsung ketahuan
#   3. `bin/busybox` di dalam arsip dicek dengan `file`: harus ELF arch yang diminta
#      (rootfs x86_64 di HP arm64 = "tidak bisa exec", dan itu selalu terungkap di sini)

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/lib/common.sh"

MIRROR="https://downloads.openwrt.org"
ARCH=""; RELEASE="24.10.5"; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arch)    ARCH=$2; shift 2 ;;
    --release) RELEASE=$2; shift 2 ;;
    --out)     OUT=$2; shift 2 ;;
    --mirror)  MIRROR=$2; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done
[ -n "$ARCH" ] || die "--arch wajib (arm64|x86_64)"
[ -n "$OUT" ]  || OUT="out/rootfs"

# arch -> target/subtarget (subset OpenWrt 24.10 yang dipakai repo ini)
case "$ARCH" in
  arm64)  TARGET="armsr"; SUBTARGET="armv8"; EF_CHECK="aarch64" ;;
  x86_64) TARGET="x86";   SUBTARGET="64";    EF_CHECK="x86-64" ;;
  *) die "arch tidak didukung: $ARCH (pakai arm64 atau x86_64)";;
esac

need curl
need tar
have file || warn "'file' tidak ada — langkah verifikasi arsitektur dilewati"

BASE="$MIRROR/releases/$RELEASE/targets/$TARGET/$SUBTARGET"
PREFIX="openwrt-$RELEASE-$TARGET-$SUBTARGET"
FILE="$PREFIX-rootfs.tar.gz"
mkdir -p "$OUT"

# --- eta hash dari sha256sums resmi -----------------------------------------
log "ambil daftar hash resmi: $BASE/sha256sums"
SUM_FILE="$OUT/sha256sums.$PREFIX"
fetch_to "$BASE/sha256sums" "$SUM_FILE"
WANT=$(awk -v f="$FILE" '$2 == f || $2 == "*"f {print $1}' "$SUM_FILE" | head -1)
[ -n "$WANT" ] || die "berkas $FILE tidak ada di sha256sums (rilis $RELEASE / $TARGET $SUBTARGET salah?)"

# --- unduh + verifikasi ------------------------------------------------------
fetch_to "$BASE/$FILE" "$OUT/$FILE" "$WANT"

log "uji integritas arsip (tar tzf) …"
tar tzf "$OUT/$FILE" >/dev/null || die "arsip rusak: $OUT/$FILE"
ok "arsip terbaca"

if have file; then
  TMPD=$(mktemp -d)
  trap 'rm -rf "$TMPD"' EXIT
  tar xzf "$OUT/$FILE" -C "$TMPD" ./bin/busybox 2>/dev/null || tar xzf "$OUT/$FILE" -C "$TMPD" bin/busybox
  [ -f "$TMPD/bin/busybox" ] || die "bin/busybox tidak ada di dalam rootfs — rootfs ini tidak seperti OpenWrt"
  INF=$(file -b "$TMPD/bin/busybox")
  log "bin/busybox: $INF"
  case "$INF" in
    *"$EF_CHECK"*) ok "arsitektur cocok ($EF_CHECK)" ;;
    *) die "arsitektur SALAH: rootfs $ARCH tapi busybox = $INF" ;;
  esac
fi

echo
ok "rootfs siap: $OUT/$FILE ($(mib_of "$OUT/$FILE") MiB)"
cat <<EOF

Lanjut:
  # ke HP Android yang sudah root (jalur A):
  ./scripts/chroot/deploy-rootfs.sh --device mido --ssh root@192.168.42.1 --tarball $OUT/$FILE

  # atau jalur B (rootfs untuk perangkat/mainline): pakai image buildroot di docs/03
EOF
