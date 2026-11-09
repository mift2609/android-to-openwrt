#!/bin/sh
# probe-device.sh — baca perangkat Qualcomm yang tersambung dan isi nilai yang HARUS diukur.
#
# Pakai:
#   ./scripts/devices/probe-device.sh --device mido --boot-img ~/stok-boot.img
#   ./scripts/devices/probe-device.sh --device rolex --adb <serial>
#   ./scripts/devices/probe-device.sh --device mido --update-profile --boot-img boot.img
#
# Yang dibaca dan mengapa:
#   * bootloader mana yang menjawab fastboot (aboot stok vs lk2nd) -> menentukan di mana
#     image kernel harus ditulis (offset 0 vs 512 KiB). Salah pilih = bootloader hilang.
#   * argumen mkbootimg (base/offset/pagesize/header_version) + cmdline dari boot image
#     yang SUDAH terbukti boot di perangkat itu. Ini satu-satunya sumber yang boleh dipakai;
#     nilai dari internet untuk perangkat lain = image yang tidak dikenali bootloader.
#   * nama partisi (boot/userdata) dari /proc/partitions + by-name, bukan dari nomor tebakan.
#
# Skrip ini TIDAK menulis apa pun ke perangkat. Hanya membaca.

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"

DEVICE=""; SERIAL=""; BOOTIMG=""; PULL=0; UPDATE=0; REPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --device)         DEVICE=$2; shift 2 ;;
    --serial)         SERIAL=$2; shift 2 ;;
    --boot-img)       BOOTIMG=$2; shift 2 ;;
    --pull-boot)      PULL=1; shift ;;
    --update-profile) UPDATE=1; shift ;;
    -h|--help)        sed -n '2,18p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done
[ -n "$DEVICE" ] || die "--device wajib"
DEV_DIR="$(repo_root)/devices/$DEVICE"
[ -d "$DEV_DIR" ] || die "profil tidak ada: $DEV_DIR"
REPORT="$DEV_DIR/probe-report.txt"

FB="fastboot"; ADB="adb"
[ -n "$SERIAL" ] && { FB="fastboot -s $SERIAL"; ADB="adb -s $SERIAL"; }

: > "$REPORT"
say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
hd()  { printf '\n=== %s ===\n' "$*" | tee -a "$REPORT"; }

hd "identitas perangkat"
if command -v fastboot >/dev/null && $FB devices 2>/dev/null | grep -q .; then
  say "[fastboot] perangkat terdeteksi"
  $FB getvar all 2>&1 | tee -a "$REPORT" | head -3 >/dev/null || true
  VARS=$($FB getvar all 2>&1 || true)
  printf '%s' "$VARS" | grep -E '^(product|variant|secure|unlocked|current-slot|partition-size:boot|partition-size:userdata|partition-type:boot)' | sed 's/^/  /' | tee -a "$REPORT"
  NPT=$(printf '%s' "$VARS" | grep -c 'partition-type:' || true)
  say "  jumlah entri 'partition-type:' = $NPT"
  if [ "$NPT" -gt 10 ]; then
    say "  -> bootloader yang menjawab: LK2ND (banyak partisi terdaftar)"
    say "     tulis image kernel DARI lk2nd (offset $(printf '%s' "${LK2ND_OFFSET_KIB:-512}") KiB akan dipakai otomatis)"
  else
    say "  -> bootloader yang menjawab: aboot STOK (~3 partisi saja)"
    say "     aboot stok tidak bisa boot kernel mainline; pasang lk2nd dulu (fastboot flash boot lk2nd-<soc>.img)"
  fi
  if $FB oem log >/dev/null 2>&1; then say "  'fastboot oem log' menjawab OKAY -> ini lk2nd"; else say "  'fastboot oem log' tidak dikenal -> ini aboot stok"; fi
else
  say "[fastboot] tidak ada perangkat di fastboot"
fi

if command -v adb >/dev/null && $ADB get-state 2>/dev/null | grep -q device; then
  hd "identitas (adb)"
  for p in ro.product.device ro.product.model ro.board.platform ro.boot.hardware ro.build.version.release; do
    printf '  %s = %s\n' "$p" "$($ADB shell getprop "$p" 2>/dev/null | tr -d '\r')" | tee -a "$REPORT"
  done
  printf '  id -u  = %s (root?)\n' "$($ADB shell id -u 2>/dev/null | tr -d '\r')" | tee -a "$REPORT"
  say "  partisi by-name (boot/userdata):"
  $ADB shell 'ls -l /dev/block/bootdevice/by-name/ 2>/dev/null | grep -E "boot|userdata"' 2>/dev/null | tr -d '\r' | sed 's/^/    /' | tee -a "$REPORT" || true
  if [ "$PULL" = 1 ] && [ -z "$BOOTIMG" ]; then
    hd "menarik boot.img dari perangkat (butuh root)"
    if [ "$($ADB shell id -u 2>/dev/null | tr -d '\r')" = "0" ]; then
      TMPIMG="/data/local/tmp/boot-pull.img"
      $ADB shell "dd if=/dev/block/bootdevice/by-name/boot of=$TMPIMG bs=1M" 2>&1 | tail -1 | sed 's/^/  /' | tee -a "$REPORT"
      $ADB pull "$TMPIMG" "$DEV_DIR/boot-current.img" >/dev/null 2>&1 && ok "boot image tersimpan: $DEV_DIR/boot-current.img"
      warn "PERHATIAN: ini DUMP PARTISI UTUH (lk2nd + kernel di dalamnya), bukan artefak fastboot."
      warn "Jangan pernah mem-flash berkas ini dengan 'fastboot flash boot': isinya akan bergeser 512 KiB."
      BOOTIMG="$DEV_DIR/boot-current.img"
    else
      warn "sesi adb bukan root — tidak bisa dd partisi boot"
    fi
  fi
else
  say "[adb] tidak ada perangkat di adb"
fi

# --- argumen mkbootimg dari boot image ---------------------------------------
if [ -n "$BOOTIMG" ]; then
  hd "argumen mkbootimg + cmdline dari $BOOTIMG"
  [ -f "$BOOTIMG" ] || die "boot image tidak ada: $BOOTIMG"
  UNPACK="$(repo_root)/scripts/tools/unpack_bootimg.py"
  TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
  if OUT=$($UNPACK --boot_img "$BOOTIMG" --format mkbootimg --out "$TMPD" 2>/dev/null | tail -1); then
    say "  keluaran mentah:"
    say "    $OUT"
    ARGS=$(printf '%s' "$OUT" | sed -e 's/^\s*//' -e 's/--kernel [^ ]*//' -e 's/--ramdisk [^ ]*//' -e "s/--cmdline '[^']*'//" -e 's/--output [^ ]*//' -e 's/  */ /g' -e 's/^ //' -e 's/ $//')
    CMDL=$(printf '%s' "$OUT" | sed -n "s/.*--cmdline '\([^']*\)'.*/\1/p")
    say ""
    say "  -> baris siap tempel untuk devices/$DEVICE/device.conf:"
    say "     MKBOOTIMG_ARGS=\"$ARGS\""
    say "     KERNEL_CMDLINE=\"$CMDL\""
    if [ "$UPDATE" = 1 ]; then
      python3 - "$DEV_DIR/device.conf" "$ARGS" "$CMDL" <<'PY'
import re, sys
path, args, cmd = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
s = re.sub(r'(?m)^MKBOOTIMG_ARGS=.*$', 'MKBOOTIMG_ARGS="%s"' % args, s)
s = re.sub(r'(?m)^KERNEL_CMDLINE=.*$', 'KERNEL_CMDLINE="%s"' % cmd, s)
open(path, 'w').write(s)
print("  device.conf diperbarui (MKBOOTIMG_ARGS, KERNEL_CMDLINE)")
PY
    fi
  else
    warn "gagal membongkar $BOOTIMG — mungkin bukan boot image Android, atau header versi 3/4 dengan vendor boot"
  fi
else
  hd "argumen mkbootimg"
  say "  belum ada boot image. Ambil boot stok dari firmware resmi, atau --pull-boot (adb root),"
  say "  lalu jalankan lagi dengan --boot-img <berkas>."
fi

ok "laporan: $REPORT"
[ "$UPDATE" = 1 ] || log "tambahkan --update-profile untuk menulis MKBOOTIMG_ARGS/CMDLINE langsung ke device.conf"
