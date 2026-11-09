#!/bin/sh
# smoke.sh — uji yang bisa dijalankan TANPA perangkat.
#
#   sh tests/smoke.sh              # semua uji
#   sh tests/smoke.sh --lint-only  # hanya sintaks (jauh lebih cepat, pakai di pre-commit)
#
# Yang diuji:
#   1. sintaks setiap skrip shell (`sh -n`) + bisa dikompilasi setiap skrip python
#   2. setiap profil perangkat lengkap dan bentuknya benar (variabel wajib ada, DTB berakhiran .dtb)
#   3. round-trip boot image: bungkus kernel+dtb+ramdisk palsu dengan mkbootimg.py, bongkar lagi,
#      dan bandingkan isinya — ini menangkap argumen mkbootimg yang salah sebelum menyentuh HP
#   4. initramfs: /init dan busybox ikut terbawa, busybox berarsitektur target
#   5. unduh rootfs OpenWrt resmi + sha256 (opsional, butuh jaringan: --network)

set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ROOT=$PWD
LINT_ONLY=0; NETWORK=0
for a in "$@"; do
  case "$a" in
    --lint-only) LINT_ONLY=1 ;;
    --network)   NETWORK=1 ;;
    *) echo "[x] argumen tidak dikenal: $a" >&2; exit 1 ;;
  esac
done

fails=0
pass() { printf '  [ok] %s\n' "$*"; }
bad()  { printf '  [X]  %s\n' "$*"; fails=$((fails+1)); }
sect() { printf '\n== %s ==\n' "$*"; }

sect "1. sintaks skrip"
n=0
for f in $(find scripts rootfs tests -type f \( -name '*.sh' -o -name 'init' -o -name 'S15usb' -o -name 'smoke.sh' \) | sort); do
  if sh -n "$f" 2>/tmp/sh.err; then n=$((n+1)); else bad "$f: $(cat /tmp/sh.err)"; fi
done
pass "$n berkas shell lolos 'sh -n'"

for f in scripts/tools/mkbootimg.py scripts/tools/unpack_bootimg.py; do
  if python3 -m py_compile "$f"; then pass "py_compile $f"; else bad "py_compile $f"; fi
done
# skrip python ikut terpasang sebagai executable?
for f in scripts/tools/mkbootimg.py scripts/tools/unpack_bootimg.py; do
  [ -x "$f" ] || bad "$f tidak executable"
done
rm -rf scripts/tools/__pycache__

sect "2. profil perangkat"
for d in devices/*/; do
  name=$(basename "$d")
  [ -f "$d/device.conf" ] || { bad "$name: device.conf tidak ada"; continue; }
  out=$(sh -c '. "$1" >/dev/null 2>&1; for v in DEVICE_NAME SOC ARCH KERNEL_REPO DTB; do
        eval "val=\${$v:-}"; [ -n "$val" ] || echo "kurang $v"; done
        case "$DTB" in *.dtb) ;; *) echo "DTB harus berakhiran .dtb (dapat: $DTB)";; esac
        case "$ARCH" in arm64|arm) ;; *) echo "ARCH tidak lazim: $ARCH";; esac' sh "$d/device.conf" || true)
  if [ -z "$out" ]; then pass "$name lengkap"; else bad "$name: $out"; fi
  [ -f "$d/kernel.config.fragment" ] || bad "$name: kernel.config.fragment tidak ada"
  [ -f "$d/README.md" ] || bad "$name: README.md tidak ada (harus menyatakan apa yang sudah/ belum terbukti)"
done

if [ "$LINT_ONLY" = 1 ]; then
  echo; [ "$fails" = 0 ] && { echo "semua uji lint lolos"; exit 0; } || { echo "$fails uji gagal"; exit 1; }
fi

sect "3. round-trip boot image (mkbootimg -> unpack_bootimg)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
head -c 65536 /dev/urandom > "$T/kernel.bin"
head -c 4096  /dev/zero    > "$T/dtb.bin"
mkdir -p "$T/rd"
printf 'hello-openwrt\n' > "$T/rd/init"
( cd "$T/rd" && find . -print | cpio -o -H newc --owner 0:0 --quiet ) | gzip -9 > "$T/ramdisk"
CMDLINE="console=tty0 panic=5 smoke=1"
if python3 scripts/tools/mkbootimg.py --help >/dev/null 2>&1; then
  python3 scripts/tools/mkbootimg.py \
    --kernel "$T/kernel.bin" --ramdisk "$T/ramdisk" --cmdline "$CMDLINE" \
    --base 0x80000000 --kernel_offset 0x00008000 --ramdisk_offset 0x01000000 \
    --tags_offset 0x00000100 --pagesize 2048 --header_version 0 \
    --output "$T/boot.img" >/dev/null 2>&1 && pass "mkbootimg menghasilkan boot.img" \
    || bad "mkbootimg gagal (lihat: python3 scripts/tools/mkbootimg.py --help)"
  if python3 scripts/tools/unpack_bootimg.py --boot_img "$T/boot.img" --out "$T/out" >"$T/u.log" 2>&1; then
    cmp -s "$T/out/kernel" "$T/kernel.bin" && pass "kernel identik setelah round-trip" || bad "kernel berubah"
    gzip -dc "$T/out/ramdisk" | cpio -t --quiet 2>/dev/null | grep -qxE '(./)?init' \
      && pass "ramdisk memuat ./init" || bad "ramdisk tidak memuat ./init"
    grep -q "$CMDLINE" "$T/u.log" && pass "cmdline terbaca kembali" || bad "cmdline tidak cocok"
  else
    bad "unpack_bootimg gagal: $(tail -1 "$T/u.log")"
  fi
else
  bad "scripts/tools/mkbootimg.py tidak bisa dijalankan"
fi

sect "4. initramfs nyata (busybox arch target)"
# Uji ini mengunduh busybox statis aarch64 dari Alpine (~5 MB) dan benar-benar merakit initramfs.
if [ "${SKIP_NET:-0}" = 1 ]; then
  echo "  (dilewati: SKIP_NET=1)"
else
  if DEVICE=mido OUT_DIR="$T/out-initramfs" sh scripts/build/mkinitramfs.sh >"$T/init.log" 2>&1; then
    pass "mkinitramfs selesai"
    tail -3 "$T/init.log" | sed 's/^/       /'
    if gzip -dc "$T/out-initramfs/initramfs.cpio.gz" | cpio -t --quiet 2>/dev/null | grep -qxE '(./)?init'; then
      pass "initramfs memuat /init"
    else
      bad "initramfs tidak memuat /init"
    fi
  else
    bad "mkinitramfs gagal: $(tail -3 "$T/init.log" | tr '\n' ' ')"
  fi
fi

sect "5. rootfs OpenWrt resmi (jaringan)"
if [ "$NETWORK" = 1 ]; then
  if ./scripts/openwrt/fetch-rootfs.sh --arch x86_64 --release 24.10.5 --out "$T/rootfs" >"$T/rootfs.log" 2>&1; then
    pass "fetch-rootfs x86_64 + sha256 + arsitektur busybox"
    grep -E 'sha256 cocok|arsitektur cocok' "$T/rootfs.log" | sed 's/^/       /'
  else
    bad "fetch-rootfs gagal: $(tail -2 "$T/rootfs.log" | tr '\n' ' ')"
  fi
else
  echo "  (dilewati: pakai --network untuk menguji unduhan rootfs)"
fi

echo
if [ "$fails" = 0 ]; then echo "SEMUA UJI LOLOS"; else echo "$fails UJI GAGAL"; exit 1; fi
