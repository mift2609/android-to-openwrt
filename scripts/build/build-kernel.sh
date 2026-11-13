#!/bin/sh
# build-kernel.sh — build kernel mainline + DTB + modul untuk perangkat Android (jalur B).
#
# Pakai:
#   DEVICE=mido ./scripts/build/build-kernel.sh                 # pakai KERNEL_TAG di device.conf
#   DEVICE=mido KERNEL_TAG=v7.1.3-r0 ./scripts/build/build-kernel.sh
#
# Kenapa "laptop sering kalah": build kernel penuh di laptop bisa puluhan menit, sementara
# workflow di .github/workflows/build-kernel.yml menyelesaikannya ~2 menit dengan ccache hangat.
# Pakai skrip ini kalau kamu butuh iterasi cepat pada config/DTB, atau saat offline.
#
# Hasil di out/<device>/:
#   Image.gz            kernel terkompresi
#   qcom/<board>.dtb    DTB perangkat
#   Image.gz-dtb        kernel + DTB di-append (wajib untuk bootloader Qualcomm)
#   modules/            pohon /lib/modules siap-tempel ke rootfs
#   .config             konfigurasi final (arsip bukti)

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"
load_device

OUT="$(repo_root)/out/$DEVICE"
SRC="$OUT/src"
mkdir -p "$OUT"
KERNEL_TAG=${KERNEL_TAG:-$KERNEL_TAG_DEFAULT}
: "${KERNEL_TAG:?KERNEL_TAG kosong}"

need make
need tar
have curl || have wget || die "butuh curl atau wget"

# --- 1. sumber kernel (tarball tag, bukan git clone: jauh lebih cepat) --------
TARBALL="$OUT/linux-$KERNEL_TAG.tar.gz"
URL="$KERNEL_REPO/archive/refs/tags/$KERNEL_TAG.tar.gz"
fetch_to "$URL" "$TARBALL"

if [ ! -d "$SRC/.git" ] && [ ! -f "$SRC/Makefile" ]; then
  log "ekstrak sumber kernel"
  rm -rf "$SRC.tmp"; mkdir -p "$SRC.tmp"
  tar xzf "$TARBALL" -C "$SRC.tmp" --strip-components=1
  mv "$SRC.tmp" "$SRC"
fi
[ -f "$SRC/Makefile" ] || die "sumber kernel tidak lengkap di $SRC"

# --- 2. config dasar + fragment ---------------------------------------------
log "defconfig platform + fragment perangkat"
export ARCH CROSS_COMPILE

# --- 1b. DTS perangkat yang belum ada di upstream ---------------------------
# Tanpa ini `make dtbs` tidak pernah menghasilkan DTB untuk perangkat seperti b2q
# (sm8350.dtsi sudah upstream, DTS perangkatnya belum). Untuk mido/rolex nilainya kosong.
if [ -n "${DEVICE_DTS_SRC:-}" ]; then
  "$(repo_root)/scripts/build/apply-device-dts.sh" --tree "$SRC" --src "$(repo_root)/$DEVICE_DTS_SRC"
fi
make -C "$SRC" ARCH="$ARCH" CROSS_COMPILE="$CROSS_COMPILE" defconfig >/dev/null
FRAG="$(repo_root)/${KERNEL_CONFIG_FRAGMENT:-devices/$DEVICE/kernel.config.fragment}"
[ -f "$FRAG" ] || die "fragment config tidak ada: $FRAG"
"$(repo_root)/scripts/build/apply-config-fragment.sh" --tree "$SRC" --fragment "$FRAG"

# --- 3. build ----------------------------------------------------------------
JOBS=${JOBS:-$(nproc)}
log "build kernel + dtbs + modules (-j$JOBS) — ini bagian yang lama"
make -C "$SRC" ARCH="$ARCH" CROSS_COMPILE="$CROSS_COMPILE" -j"$JOBS" Image.gz dtbs modules

# --- 4. staging --------------------------------------------------------------
KIMG="$SRC/arch/$ARCH/boot/Image.gz"
DTB_PATH="$SRC/arch/$ARCH/boot/dts/$DTB"
[ -f "$KIMG" ] || die "Image.gz tidak terbentuk"
[ -f "$DTB_PATH" ] || die "DTB tidak ditemukan: $DTB (nama DTB berubah antar tag?)"

log "staging ke $OUT"
cp -f "$KIMG" "$OUT/Image.gz"
mkdir -p "$OUT/qcom"; cp -f "$DTB_PATH" "$OUT/qcom/$(basename "$DTB")"
cp -f "$SRC/.config" "$OUT/.config"
cat "$OUT/Image.gz" "$OUT/qcom/$(basename "$DTB")" > "$OUT/Image.gz-dtb"

MODROOT="$OUT/modules"
rm -rf "$MODROOT"; mkdir -p "$MODROOT"
make -C "$SRC" ARCH="$ARCH" CROSS_COMPILE="$CROSS_COMPILE" INSTALL_MOD_PATH="$MODROOT" modules_install >/dev/null
# symlink build/ bolong dari modules_install; bukan masalah untuk rootfs perangkat
rm -f "$MODROOT/lib/modules/"*/build "$MODROOT/lib/modules/"*/source

KREL=$(make -s -C "$SRC" ARCH="$ARCH" kernelrelease)
echo "$KREL" > "$OUT/kernelrelease"

ok "kernel selesai: $KREL"
log "  kernel      : $OUT/Image.gz ($(mib_of "$OUT/Image.gz") MiB)"
log "  kernel+dtb  : $OUT/Image.gz-dtb"
log "  dtb         : $OUT/qcom/$(basename "$DTB")"
log "  modul       : $MODROOT/lib/modules/$KREL ($(find "$MODROOT" -name '*.ko' | wc -l) berkas .ko)"
echo
log "lanjut: make DEVICE=$DEVICE initramfs bootimg   (lalu docs/03 untuk flash)"
