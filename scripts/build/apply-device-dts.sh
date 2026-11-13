#!/bin/sh
# apply-device-dts.sh — masukkan DTS perangkat (yang TIDAK ada di upstream) ke pohon kernel.
#
# Pakai:
#   ./scripts/build/apply-device-dts.sh --tree out/b2q/src --src devices/b2q/dts/sm8350-samsung-b2q.dts
#   DEVICE=b2q ./scripts/build/apply-device-dts.sh --tree out/b2q/src     # ambil dari device.conf
#
# Kenapa skrip ini ada: untuk perangkat yang DTS-nya belum upstream (b2q belum; sm8350.dtsi
# sudah), build tidak akan pernah menghasilkan DTB. Menyalin berkas saja TIDAK cukup —
# `make dtbs` hanya membangun DTB yang terdaftar di arch/<arch>/boot/dts/qcom/Makefile.
# Skrip ini melakukan keduanya dan membuktikan hasilnya (berkas ada + entri Makefile ada).
#
# Kalau DEVICE_DTS_SRC kosong (perangkat yang DTS-nya sudah upstream, mis. mido/rolex),
# skrip keluar tanpa melakukan apa pun — jadi aman dipanggil untuk semua perangkat.

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"

TREE=""; SRC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tree) TREE=$2; shift 2 ;;
    --src)  SRC=$2;  shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done

[ -n "$TREE" ] || die "--tree wajib (pohon kernel yang sudah diekstrak)"

# Ambil nilai dari profil perangkat kalau tidak diberikan eksplisit.
# DEVICE hanya wajib kalau ARCH/DTB belum ada di environment — pemanggilan ad-hoc
# (--tree ... --src ...) tidak perlu profil.
if [ -z "$SRC" ] || [ -z "${ARCH:-}" ] || [ -z "${DTB:-}" ]; then
  if [ -n "${DEVICE:-}" ]; then
    load_device
    [ -n "$SRC" ] || SRC="$(repo_root)/${DEVICE_DTS_SRC:-}"
  else
    ARCH=${ARCH:-arm64}
    [ -n "$SRC" ] || die "--src wajib kalau DEVICE tidak diset"
  fi
fi
[ -n "$ARCH" ] || die "ARCH kosong"

[ -n "$SRC" ] || { log "device.conf tidak punya DEVICE_DTS_SRC -> DTS dianggap sudah upstream, tidak ada yang disalin"; exit 0; }
[ -f "$SRC" ] || die "DTS perangkat tidak ada: $SRC (REPO=$repo_root)"

NAME=$(basename "$SRC")
DST_DIR="$TREE/arch/$ARCH/boot/dts/qcom"
MK="$DST_DIR/Makefile"
[ -d "$DST_DIR" ] || die "direktori DTS qcom tidak ada di pohon kernel: $DST_DIR"
[ -f "$MK" ] || die "Makefile DTS tidak ada: $MK"

log "salin DTS perangkat: $NAME -> arch/$ARCH/boot/dts/qcom/"
cp -f "$SRC" "$DST_DIR/$NAME"

BASE=${NAME%.dts}
ENTRY="dtb-\$(CONFIG_ARCH_QCOM) += $BASE.dtb"
if grep -qxF "$ENTRY" "$MK"; then
  log "entri Makefile sudah ada"
else
  # Disisipkan pada blok dtb-$(CONFIG_ARCH_QCOM) pertama supaya urutannya rapi.
  awk -v e="$ENTRY" '
    !done && /^dtb-\$\(CONFIG_ARCH_QCOM\) \+=/ { print; print e; done=1; next }
    { print }
  ' "$MK" > "$MK.tmp"
  mv "$MK.tmp" "$MK"
  ok "entri Makefile ditambahkan: $ENTRY"
fi

# --- bukti, bukan klaim ------------------------------------------------------
[ -f "$DST_DIR/$NAME" ] || die "DTS tidak mendarat di pohon kernel"
grep -qxF "$ENTRY" "$MK" || die "entri Makefile tidak mendarat"
log "  DTB yang akan dibangun: arch/$ARCH/boot/dts/${DTB:-<tidak diset di environment>}"
if [ -n "${DTB:-}" ]; then
  case "$DTB" in
    *"$BASE"*) : ;;
    *) warn "nama DTB di device.conf ($DTB) tidak memuat $BASE — cek konsistensinya" ;;
  esac
fi
