#!/bin/sh
# Helper umum untuk semua skrip host di repo ini.
# Dipakai dengan: . "$(dirname "$0")/../lib/common.sh"
# POSIX sh — jangan pakai bashisme (skrip ini juga di-source oleh skrip /system/bin/sh).

# ---- output -----------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  _c_reset='\033[0m'; _c_dim='\033[2m'; _c_ok='\033[32m'; _c_warn='\033[33m'; _c_err='\033[31m'
else
  _c_reset=''; _c_dim=''; _c_ok=''; _c_warn=''; _c_err=''
fi

log()  { printf "${_c_dim}[*]${_c_reset} %s\n" "$*"; }
ok()   { printf "${_c_ok}[ok]${_c_reset} %s\n" "$*"; }
warn() { printf "${_c_warn}[!]${_c_reset} %s\n" "$*" >&2; }
die()  { printf "${_c_err}[x]${_c_reset} %s\n" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || die "butuh '$1' — pasang dulu di host"; }

# ---- util -------------------------------------------------------------------
# sha256 file, portabel (coreutils di Linux, shasum di macOS)
sha256_of() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif have shasum;   then shasum -a 256 "$1" | awk '{print $1}'
  else die "tidak ada sha256sum/shasum"; fi
}

# ukuran file dalam MiB (untuk laporan ke user)
mib_of() { printf '%s' "$(( $(wc -c < "$1") / 1048576 ))"; }

repo_root() {
  d=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  while [ "$d" != / ]; do
    [ -f "$d/README.md" ] && [ -d "$d/scripts" ] && { printf '%s' "$d"; return 0; }
    d=$(dirname -- "$d")
  done
  die "tidak menemukan root repo (cari README.md + scripts/)"
}

# Sumber profil perangkat: set DEVICE=<nama>, panggil load_device
load_device() {
  [ -n "${DEVICE:-}" ] || die "DEVICE belum diset (contoh: DEVICE=mido make bootimg)"
  DEVICE_DIR="$(repo_root)/devices/$DEVICE"
  [ -f "$DEVICE_DIR/device.conf" ] || die "profil perangkat tidak ada: $DEVICE_DIR/device.conf"
  # shellcheck disable=SC1090
  . "$DEVICE_DIR/device.conf"
  for v in DEVICE_NAME SOC ARCH KERNEL_REPO DTB; do
    eval "val=\${$v:-}"
    [ -n "$val" ] || die "device.conf '$DEVICE' kurang variabel $v"
  done
  ok "perangkat: $DEVICE_NAME ($SOC, $ARCH)"
}

# Ambil URL dengan curl/wget dan simpan; verifikasi sha256 bila hash diberikan.
# fetch_to <url> <dest> [sha256]
fetch_to() {
  _url=$1; _dest=$2; _want=${3:-}
  if [ -f "$_dest" ] && [ -n "$_want" ] && [ "$(sha256_of "$_dest")" = "$_want" ]; then
    ok "sudah ada & hash cocok: $_dest ($(mib_of "$_dest") MiB)"
    return 0
  fi
  log "unduh $(basename "$_dest")"
  if have curl; then curl -fL --retry 3 -o "$_dest.part" "$_url"
  elif have wget; then wget -q -O "$_dest.part" "$_url"
  else die "butuh curl atau wget"; fi
  [ -s "$_dest.part" ] || { rm -f "$_dest.part"; die "unduhan kosong: $_url"; }
  mv "$_dest.part" "$_dest"
  if [ -n "$_want" ]; then
    _got=$(sha256_of "$_dest")
    [ "$_got" = "$_want" ] || { rm -f "$_dest"; die "sha256 tidak cocok untuk $_dest (dapat $_got, harus $_want)"; }
    ok "sha256 cocok: $(basename "$_dest")"
  fi
  ok "tersimpan: $_dest ($(mib_of "$_dest") MiB)"
}

# --- perintah device (SSH / adb), dipakai jalur A -----------------------------
# Format target: ssh:user@host (mis. ssh:root@192.168.42.1) atau adb:<serial>
#
# adb di ROM user: `adb root` TIDAK bisa (adbd user build). Satu-satunya jalur root di
# perangkat ber-Magisk/KernelSU adalah `su`. Karena perintah di jalur A sering berupa
# skrip multi-baris dengan kutip bersarang, skrip dikirim lewat stdin ke `su -c 'sh -s'`
# alih-alih disisipkan ke argumen — jadi tidak ada kutip yang perlu di-escape.
# Hasil deteksi di-cache di _ADB_UID supaya tidak ada panggilan adb ekstra tiap perintah.
_adb_uid() {
  if [ -z "${_ADB_UID:-}" ]; then
    _ADB_UID=$(adb ${ADB_SERIAL:+-s "$ADB_SERIAL"} shell 'id -u' 2>/dev/null | tr -d '\r')
    [ -n "$_ADB_UID" ] || _ADB_UID=none
  fi
  printf '%s' "$_ADB_UID"
}

_adb_su_available() {
  adb ${ADB_SERIAL:+-s "$ADB_SERIAL"} shell 'command -v su' 2>/dev/null | tr -d '\r' | grep -q .
}

run_on_device() {
  case "${TARGET:?TARGET belum diset}" in
    ssh:*) ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
              -o ConnectTimeout=10 "${TARGET#ssh:}" "$@" ;;
    adb:*)
      if [ "$(_adb_uid)" = "0" ]; then
        adb ${ADB_SERIAL:+-s "$ADB_SERIAL"} shell "$@"
      elif _adb_su_available; then
        printf '%s\n' "$@" | adb ${ADB_SERIAL:+-s "$ADB_SERIAL"} shell 'su -c "sh -s"'
      else
        die "adbd bukan root dan tidak ada 'su' di perangkat — jalur A butuh root (Magisk/KernelSU)"
      fi ;;
    *) die "TARGET harus ssh:user@host atau adb:<serial> (dapat: $TARGET)" ;;
  esac
}

push_to_device() {  # push_to_device <lokal> <remote>
  case "$TARGET" in
    ssh:*) scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$1" "${TARGET#ssh:}:$2" ;;
    adb:*) adb ${ADB_SERIAL:+-s "$ADB_SERIAL"} push "$1" "$2" ;;
  esac
}

# Pastikan perangkat memang root (jalur A butuh root untuk chroot)
assert_device_root() {
  _u=$(run_on_device 'id -u' 2>/dev/null | tr -d '\r')
  [ "$_u" = "0" ] || die "sesi ke perangkat bukan root (id -u = ${_u:-kosong}). Untuk ssh: set PermitRootLogin/authorized_keys root; untuk adb di ROM user: 'adb root' tidak bisa, pakai Magisk/KernelSU (skrip ini otomatis memakai 'su')."
  ok "perangkat menjawab sebagai root"
}
