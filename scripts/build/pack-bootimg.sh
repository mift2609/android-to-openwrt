#!/bin/sh
# pack-bootimg.sh — rakit boot.img dari kernel + DTB + initramfs, lalu BONGKAR ULANG untuk bukti.
#
# Pakai: DEVICE=mido ./scripts/build/pack-bootimg.sh
#
# Aturan yang tidak boleh dilanggar:
#   1. DTB di-append ke kernel (banyak bootloader Qualcomm tidak membaca DTB dari header
#      boot image: `fastboot boot` menjawab FAILED (remote: 'dtb not found')).
#   2. Argumen mkbootimg (base/offset/pagesize/header_version) harus SAMA dengan boot image
#      yang sudah terbukti boot di perangkat itu. Ambil dari devices/<dev>/device.conf,
#      dan isi device.conf itu dari boot image nyata via scripts/devices/probe-device.sh.
#   3. Setelah dibungkus, image dibongkar ulang dan isinya dibandingkan — "mkbootimg sukses"
#      bukan bukti bahwa kernel+ramdisk yang benar yang masuk.

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"
load_device

OUT="${OUT_DIR:-$(repo_root)/out/$DEVICE}"
MKBOOTIMG="$(repo_root)/scripts/tools/mkbootimg.py"
UNPACK="$(repo_root)/scripts/tools/unpack_bootimg.py"
KIMG="$OUT/Image.gz"
DTB_FILE="$OUT/qcom/$(basename "$DTB")"
RAMDISK="$OUT/initramfs.cpio.gz"

for f in "$KIMG" "$DTB_FILE" "$RAMDISK"; do
  [ -f "$f" ] || die "belum ada: $f (jalankan build-kernel.sh lalu mkinitramfs.sh)"
done
[ -f "$MKBOOTIMG" ] || die "scripts/tools/mkbootimg.py tidak ada"

log "append DTB ke kernel (Image.gz-dtb)"
cat "$KIMG" "$DTB_FILE" > "$OUT/Image.gz-dtb"

BOOTIMG="$OUT/boot.img"
# shellcheck disable=SC2086  # MKBOOTIMG_ARGS memang daftar argumen, sengaja tanpa kutip
log "mkbootimg: $MKBOOTIMG_ARGS"
python3 "$MKBOOTIMG" \
  --kernel "$OUT/Image.gz-dtb" \
  --ramdisk "$RAMDISK" \
  --cmdline "$KERNEL_CMDLINE" \
  $MKBOOTIMG_ARGS \
  --output "$BOOTIMG"

# --- verifikasi: bongkar ulang hasilnya --------------------------------------
log "verifikasi: bongkar ulang $BOOTIMG"
VDIR="$OUT/.verify"; rm -rf "$VDIR"; mkdir -p "$VDIR"
python3 "$UNPACK" --boot_img "$BOOTIMG" --out "$VDIR" >/dev/null 2>"$VDIR/unpack.err" || {
  cat "$VDIR/unpack.err" >&2; die "boot.img hasil tidak bisa dibongkar — argumen mkbootimg salah"
}

# kernel di dalam image harus sama dengan Image.gz-dtb yang kita kirim
if [ -f "$VDIR/kernel" ]; then
  if cmp -s "$VDIR/kernel" "$OUT/Image.gz-dtb"; then ok "kernel di dalam image identik dengan Image.gz-dtb"
  else die "kernel di dalam image BERBEDA dengan yang dikirim — proses packing salah"; fi
fi
if [ -f "$VDIR/ramdisk" ]; then
  # cpio menyimpan nama sebagai 'init' (GNU cpio versi ini) atau './init'; terima keduanya —
  # memeriksa hanya './init' pernah membuat build yang SEHAT dilaporkan gagal.
  RAMLIST=$(gzip -dc "$VDIR/ramdisk" | cpio -t --quiet 2>/dev/null || true)
  if printf '%s\n' "$RAMLIST" | grep -qxE '(\./)?init'; then
    ok "ramdisk di dalam image memuat /init"
  else
    printf '%s\n' "$RAMLIST" | head -10 | sed 's/^/    /' >&2
    die "ramdisk di dalam image tidak memuat /init (daftar di atas = isi ramdisk)"
  fi
fi
grep -q "$(basename "$DTB")" "$VDIR/unpack.err" 2>/dev/null || true

# panjang kernel+dtb harus sama dengan penjumlahan bagian-bagiannya
KSZ=$(wc -c < "$OUT/Image.gz-dtb"); TSZ=$(wc -c < "$VDIR/kernel" 2>/dev/null || echo "$KSZ")
[ "$KSZ" = "$TSZ" ] || warn "ukuran kernel image ($TSZ) != Image.gz-dtb ($KSZ)"

ok "boot image: $BOOTIMG ($(mib_of "$BOOTIMG") MiB)"
sha256_of "$BOOTIMG" | sed 's/^/    sha256: /'

cat <<EOF

Cara memakainya (BACA docs/04 dulu — ada set pemulihan yang harus disiapkan):
  1. uji tanpa menulis apa pun   : fastboot boot $BOOTIMG
  2. tulis ke partisi boot       : fastboot flash boot $BOOTIMG
     (kalau lk2nd tinggal di dalam partisi boot, bootloader yang menjalankan perintah ini
      menulis di offset $(( ${LK2ND_OFFSET_KIB:-512} * 1024 )) byte secara otomatis — flash dari fastboot STOK,
      bukan dari dalam sistem, dan jangan pakai menu "Install Image -> Boot" di TWRP.)
EOF
