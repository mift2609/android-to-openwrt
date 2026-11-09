#!/bin/sh
# mkinitramfs.sh — rakit initramfs (cpio.gz) untuk boot image jalur B.
#
# Pakai: DEVICE=mido ./scripts/build/mkinitramfs.sh
#
# Yang dilakukan:
#   1. ambil busybox STATIS untuk arsitektur TARGET dari Alpine (bukan folder /bin host!)
#      -> kesalahan klasik: busybox x86_64 dipak ke initramfs arm64, /init gagal exec,
#         kernel panik tanpa pesan dan tanpa USB: tampak persis seperti kernel hang.
#   2. susun pohon initramfs dari rootfs/initramfs (berisi /init) + /bin/busybox + modul inti
#   3. bungkus jadi cpio newc gzip, lalu VERIFIKASI isinya (baca ulang arsipnya)

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"
load_device

OUT="${OUT_DIR:-$(repo_root)/out/$DEVICE}"
STAGE="$OUT/initramfs-stage"
BB_VERSION=${BB_VERSION:-1.36.1-r31}
ALPINE_BASE=${ALPINE_BASE:-https://dl-cdn.alpinelinux.org/alpine/v3.20/main}

case "$ARCH" in
  arm64)  BB_ARCH=aarch64; EF_CHECK=aarch64 ;;
  arm)    BB_ARCH=armhf;   EF_CHECK=ARM ;;
  *) die "ARCH tidak didukung di skrip ini: $ARCH" ;;
esac

need cpio
need gzip
need tar
have file || warn "'file' tidak ada — verifikasi arsitektur busybox dilewati (jangan lakukan ini di CI)"

mkdir -p "$OUT"
# --- 1. busybox statis arch target -------------------------------------------
APK="$OUT/busybox-static-$BB_VERSION-$BB_ARCH.apk"
fetch_to "$ALPINE_BASE/$BB_ARCH/busybox-static-$BB_VERSION.apk" "$APK"

rm -rf "$STAGE"; mkdir -p "$STAGE/bin" "$STAGE/dev" "$STAGE/proc" "$STAGE/sys" "$STAGE/tmp" "$STAGE/etc"
tar xzf "$APK" -C "$STAGE" bin/busybox.static
[ -f "$STAGE/bin/busybox.static" ] || die "busybox.static tidak ada di dalam apk"
mv "$STAGE/bin/busybox.static" "$STAGE/bin/busybox"
chmod 755 "$STAGE/bin/busybox"

if have file; then
  INF=$(file -b "$STAGE/bin/busybox")
  case "$INF" in
    *"$EF_CHECK"*) ok "busybox target-arch: $INF" ;;
    *) die "busybox SALAH arsitektur: $INF (harus $EF_CHECK) — initramfs ini akan gagal exec di perangkat" ;;
  esac
fi

# --- 2. isi initramfs --------------------------------------------------------
cp -f "$(repo_root)/rootfs/initramfs/init" "$STAGE/init"
chmod 755 "$STAGE/init"
cp -f "$(repo_root)/rootfs/initramfs/udhcpc.script" "$STAGE/etc/udhcpc.script" 2>/dev/null || true
chmod 755 "$STAGE/etc/udhcpc.script" 2>/dev/null || true
chmod 1777 "$STAGE/tmp"
mkdir -p "$STAGE/lib/modules"

# modul inti (kalau sudah dibuild) — hanya yang dibutuhkan jaringan awal
if [ -d "$OUT/modules/lib/modules" ]; then
  KREL=$(cat "$OUT/kernelrelease" 2>/dev/null || echo "")
  if [ -n "$KREL" ] && [ -d "$OUT/modules/lib/modules/$KREL" ]; then
    log "sertakan modul initramfs dari $OUT/modules (KREL=$KREL)"
    for m in usb_f_rndis usb_f_ecm libcomposite dwc3 dwc3-qcom phy-qcom-qusb2; do
      find "$OUT/modules/lib/modules/$KREL" -name "$m.ko*" -exec cp -f {} "$STAGE/lib/modules/" \; 2>/dev/null || true
    done
    ls "$STAGE/lib/modules" | sed 's/^/    /'
  fi
else
  warn "belum ada modul hasil build ($OUT/modules) — initramfs hanya berisi driver built-in"
fi

# --- 3. bungkus + verifikasi -------------------------------------------------
IMG="$OUT/initramfs.cpio.gz"
log "bungkus cpio.gz"
( cd "$STAGE" && find . -print | cpio -o -H newc --owner 0:0 --quiet ) | gzip -9 > "$IMG"

log "verifikasi isi initramfs"
LIST=$(gzip -dc "$IMG" | cpio -t --quiet 2>/dev/null || true)
for want in init bin/busybox; do
  # cpio bisa menyimpan nama sebagai 'init' atau './init' tergantung versi; terima keduanya
  printf '%s\n' "$LIST" | grep -qxE "(\./)?$want" || die "initramfs tidak memuat $want"
done
printf '%s\n' "$LIST" | grep -qE '^(\./)?lib/modules/' && ok "modul ikut terbawa" || log "tanpa modul tambahan"
sh -n "$STAGE/init" || die "/init bukan skrip shell yang valid"

ok "initramfs: $IMG ($(mib_of "$IMG") MiB)"
log "lanjut: DEVICE=$DEVICE ./scripts/build/pack-bootimg.sh"
