#!/bin/sh
# apply-config-fragment.sh — terapkan opsi Kconfig wajib ke .config kernel, lalu BUKTIKAN hasilnya.
#
# Pakai (dari root kernel yang sudah dikonfigurasi):
#   ./scripts/build/apply-config-fragment.sh --tree <kernel-dir> --fragment devices/mido/kernel.config.fragment
#
# Kenapa ada: defconfig platform (msm8953-mainline/linux) sengaja minimalis. Opsi yang untuk
# router WAJIB built-in (=y) di sana banyak yang =m atau tidak ada sama sekali, contoh nyata
# pada tag v6.19.5-r0:
#     CONFIG_PHY_QCOM_QUSB2=m    -> USB PHY modular: gadget sering gagal probe sebelum modul dimuat
#     CONFIG_USB_CONFIGFS=m      -> gadget tidak bisa dipasang dari initramfs
#     CONFIG_NF_TABLES absent    -> firewall4 OpenWrt butuh nftables
#     CONFIG_DRM_SIMPLEDRM absent, CONFIG_FRAMEBUFFER_CONSOLE absent -> tidak ada output layar
#
# Verifikasi (bagian yang membuat skrip ini berguna):
#   1. setiap nama simbol di fragment dicocokkan ke Kconfig kernel — salah ketik = GAGAL, bukan diabaikan
#   2. setiap simbol yang diminta '=y' dicek ulang di .config hasil `make olddefconfig`
#   3. pola penolakan (`# CONFIG_X is not set`) didukung untuk simbol yang harus mati

set -eu
TREE=""; FRAGMENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tree)     TREE=$2; shift 2 ;;
    --fragment) FRAGMENT=$2; shift 2 ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "[x] argumen tidak dikenal: $1" >&2; exit 1 ;;
  esac
done
[ -n "$TREE" ] || { echo "[x] --tree wajib" >&2; exit 1; }
[ -n "$FRAGMENT" ] || { echo "[x] --fragment wajib" >&2; exit 1; }
[ -f "$TREE/scripts/config" ] || { echo "[x] bukan pohon kernel: $TREE" >&2; exit 1; }
[ -f "$FRAGMENT" ] || { echo "[x] fragment tidak ada: $FRAGMENT" >&2; exit 1; }

log() { printf '[*] %s\n' "$*"; }
ok()  { printf '[ok] %s\n' "$*"; }
die() { printf '[x] %s\n' "$*" >&2; exit 1; }

tmp_symbols=$(mktemp); tmp_lines=$(mktemp)
trap 'rm -f "$tmp_symbols" "$tmp_lines" "$tmp_symbols.bad"' EXIT

# Ambil baris EFEKTIF dari fragment: `CONFIG_X=...` dan `# CONFIG_X is not set`.
# Jangan pakai `grep -v '^#'` — filter itu membuang justru baris "is not set", yang
# berarti opsi seperti `# CONFIG_ARM64_VA_BITS_52 is not set` diam-diam tidak diterapkan
# dan choice 52-bit kembali aktif (kesalahan yang mahal: perangkat reboot di awal boot).
EFFECTIVE_RE='^[[:space:]]*(CONFIG_[A-Za-z0-9_]+=|# CONFIG_[A-Za-z0-9_]+ is not set$)'
grep -E "$EFFECTIVE_RE" "$FRAGMENT" > "$tmp_lines"

# baris non-komentar yang tidak bisa dikenali = salah tulis, jangan diabaikan
grep -vE '^[[:space:]]*($|#)' "$FRAGMENT" | grep -vE '^[[:space:]]*CONFIG_[A-Za-z0-9_]+=' > "$tmp_symbols.bad" || true
if [ -s "$tmp_symbols.bad" ]; then
  echo "[x] baris tidak dikenali di fragment:" >&2; cat "$tmp_symbols.bad" >&2; exit 1
fi

# --- 1. validasi nama simbol terhadap Kconfig --------------------------------
log "validasi $(wc -l < "$tmp_lines") opsi efektif di fragment terhadap Kconfig kernel"
while read -r line; do
  sym=$(printf '%s' "$line" | sed -n 's/^[[:space:]]*\(CONFIG_[A-Za-z0-9_]*\)=.*/\1/p')
  [ -n "$sym" ] || sym=$(printf '%s' "$line" | sed -n 's/^[[:space:]]*# \(CONFIG_[A-Za-z0-9_]*\) is not set$/\1/p')
  printf '%s\n' "$sym" >> "$tmp_symbols"
done < "$tmp_lines"

missing=""
while read -r sym; do
  # Kconfig mendefinisikan simbol TANPA awalan CONFIG_ ('config NETFILTER'), jadi buang dulu.
  bare=${sym#CONFIG_}
  grep -rqsE "^[[:space:]]*(menu)?config ${bare}\$" "$TREE" --include=Kconfig --include='Kconfig.*' || missing="$missing $sym"
done < "$tmp_symbols"
[ -z "$missing" ] || die "simbol tidak ada di kernel ini:$missing  (nama di fragment salah/basi)"

ok "semua simbol valid"

# --- 2. terapkan lewat scripts/config ----------------------------------------
# PENTING: untuk simbol bool PAKAI --enable/--disable, bukan --set-val.
# `scripts/config --set-val CONFIG_X y` menulis nilai yang tidak dikenali kconfig untuk
# bool, dan hasilnya DIAM-DIAM diabaikan saat `make olddefconfig` — persis kasus
# ARM64_VA_BITS_48: ingin 48-bit, tapi kconfig membiarkan default choice (52-bit).
log "terapkan fragment"
while read -r line; do
  case "$line" in
    *=y) "$TREE/scripts/config" --file "$TREE/.config" --enable  "${line%%=*}" ;;
    *=m) "$TREE/scripts/config" --file "$TREE/.config" --module  "${line%%=*}" ;;
    *=n) "$TREE/scripts/config" --file "$TREE/.config" --disable "${line%%=*}" ;;
    *=*) "$TREE/scripts/config" --file "$TREE/.config" --set-val "${line%%=*}" "${line#*=}" ;;
    "# "*" is not set") "$TREE/scripts/config" --file "$TREE/.config" --disable "$(printf '%s' "$line" | awk '{print $2}')" ;;
  esac
done < "$tmp_lines"
"$TREE/scripts/config" --file "$TREE/.config" --refresh-only >/dev/null 2>&1 || true
touch "$TREE/.config"

# --- 3. buktikan hasilnya ----------------------------------------------------
log "make olddefconfig (ARCH/CROSS_COMPILE dari environment pemanggil)"
if [ -n "${CROSS_COMPILE:-}" ]; then
  make -C "$TREE" ARCH="${ARCH:-arm64}" CROSS_COMPILE="$CROSS_COMPILE" olddefconfig >/dev/null
else
  make -C "$TREE" ARCH="${ARCH:-arm64}" olddefconfig >/dev/null
fi

fail=""
while read -r sym; do
  line=$(grep -E "^# $sym is not set$|^$sym=" "$tmp_lines" | head -1 || true)
  case "$line" in
    "$sym"=y) grep -q "^$sym=y$" "$TREE/.config" || fail="$fail $sym(ingin y)" ;;
    "$sym"=m) grep -q "^$sym=m$" "$TREE/.config" || fail="$fail $sym(ingin m)" ;;
    *)        # "ingin mati": cukup pastikan simbol TIDAK aktif. Simbol yang menjadi tidak
              # terlihat (mis. anggota choice yang tergantikan) tidak ditulis sama sekali
              # oleh kconfig, jadi menuntut baris "# ... is not set" akan salah alarm.
              grep -qE "^$sym=[ym]$" "$TREE/.config" && fail="$fail $sym(ingin mati)" ;;
  esac
done < "$tmp_symbols"

if [ -n "$fail" ]; then
  echo "[x] fragment tidak mendarat di .config:$fail" >&2
  echo "    penyebab umum: dependensi belum terpenuhi (opsi lain harus dulu), atau simbol dihapus di kernel ini." >&2
  exit 1
fi
ok "semua $(wc -l < "$tmp_symbols") opsi mendarat persis di $TREE/.config"
log "salinan .config: $TREE/.config"
