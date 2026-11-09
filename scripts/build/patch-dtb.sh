#!/bin/sh
# patch-dtb.sh — ubah properti DTB per-perangkat TANPA membangun ulang kernel.
#
# Pakai:
#   DEVICE=mido ./scripts/build/patch-dtb.sh --node "/soc@0/usb@7000000" --prop dr_mode --type s --value peripheral
#   DEVICE=mido ./scripts/build/patch-dtb.sh --list          # tampilkan properti kandidat
#
# Kenapa skrip, bukan langsung `fdtput`: pengubahan DTB yang salah ketik menghasilkan DTB rusak
# dan perangkat diam total — tampak persis seperti kernel hang. Skrip ini memverifikasi
# properti ADA sebelum/sesudah diubah, dan menulis Image.gz-dtb yang konsisten.

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"
load_device

OUT="$(repo_root)/out/$DEVICE"
DTB_FILE="$OUT/qcom/$(basename "$DTB")"
NODE=""; PROP=""; TYPE="s"; VALUE=""; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --node)  NODE=$2; shift 2 ;;
    --prop)  PROP=$2; shift 2 ;;
    --type)  TYPE=$2; shift 2 ;;
    --value) VALUE=$2; shift 2 ;;
    --list)  LIST=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done

need dtc || die "butuh device-tree-compiler (apt install device-tree-compiler)"
have fdtget || die "butuh fdtget/fdtput (paket device-tree-compiler)"
[ -f "$DTB_FILE" ] || die "DTB belum ada: $DTB_FILE (jalankan build-kernel.sh dulu)"

if [ "$LIST" = 1 ]; then
  log "DTB: $DTB_FILE"
  dtc -I dtb -O dts "$DTB_FILE" 2>/dev/null | grep -nE 'dr_mode|usb@|dwc3|utmi|extcon' | head -30
  exit 0
fi

[ -n "$NODE" ] || die "--node wajib (contoh: /soc@0/usb@7000000)"
[ -n "$PROP" ] || die "--prop wajib"

BEFORE=$(fdtget "$DTB_FILE" "$NODE" "$PROP" 2>/dev/null || true)
if [ -z "$BEFORE" ]; then
  warn "properti $PROP tidak ada di node $NODE (sebelum perubahan)."
  warn "Daftar node/properti yang mirip:"
  dtc -I dtb -O dts "$DTB_FILE" 2>/dev/null | grep -nE "$(printf '%s' "$PROP" | cut -c1-6)|$(printf '%s' "$NODE" | cut -c1-12)" | head -10
  die "periksa nama node/properti dulu — jangan menulis properti baru ke node yang salah"
fi
ok "sebelum: $NODE/$PROP = $BEFORE"

cp -f "$DTB_FILE" "$DTB_FILE.orig"
fdtput -t "$TYPE" "$DTB_FILE" "$NODE" "$PROP" "$VALUE"

AFTER=$(fdtget "$DTB_FILE" "$NODE" "$PROP")
[ "$AFTER" = "$VALUE" ] || { cp -f "$DTB_FILE.orig" "$DTB_FILE"; die "perubahan tidak mendarat (dapat: $AFTER) — DTB dikembalikan"; }
ok "sesudah: $NODE/$PROP = $AFTER"

# DTB harus tetap bisa dibaca (pengubahan biner bisa merusak struktur)
dtc -I dtb -O dts "$DTB_FILE" >/dev/null 2>&1 || { cp -f "$DTB_FILE.orig" "$DTB_FILE"; die "DTB rusak setelah patch — dikembalikan"; }

# rakit ulang Image.gz-dtb supaya boot image berikutnya memakai DTB baru
[ -f "$OUT/Image.gz" ] && cat "$OUT/Image.gz" "$DTB_FILE" > "$OUT/Image.gz-dtb" && ok "Image.gz-dtb dirakit ulang"
log "DTB asli disimpan: $DTB_FILE.orig (kembalikan dengan 'mv $DTB_FILE.orig $DTB_FILE')"
