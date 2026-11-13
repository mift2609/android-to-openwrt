#!/system/bin/sh
# enter.sh — DIJALANKAN DI HP ANDROID (root). Menjalankan OpenWrt di dalam chroot.
# Dipasang oleh scripts/chroot/deploy-rootfs.sh ke <CHROOT_DIR>/enter.sh
#
#   sh /data/local/openwrt/enter.sh              # shell OpenWrt (mode aman, default)
#   sh /data/local/openwrt/enter.sh --init       # procd penuh sebagai PID 1 (butuh PID namespace)
#   sh /data/local/openwrt/enter.sh --services   # tanpa procd: jalankan layanan inti saja
#   sh /data/local/openwrt/enter.sh --umount     # lepaskan semua mount chroot
#
# Yang penting dipahami: chroot BUKAN VM. Semua syscall tetap dilayani kernel Android-mu,
# jadi modul kernel OpenWrt (kmod-*) tidak bisa dipakai, dan dukungan nftables bergantung
# pada kernel Android itu. Lihat docs/02-jalur-a-chroot.md.

R="${OPENWRT_ROOT:-/data/local/openwrt}"
[ -d "$R" ] || { echo "[x] rootfs tidak ada: $R"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "[x] butuh root (adb root / su)"; exit 1; }

say() { printf '[*] %s\n' "$*"; }
die() { printf '[x] %s\n' "$*" >&2; exit 1; }

mount_all() {
  for d in proc sys dev tmp dev/pts; do
    [ -d "$R/$d" ] || mkdir -p "$R/$d"
  done
  # /dev: bind dari Android supaya node yang sudah ada (tty, kmsg, urandom) bisa dipakai
  grep -q " $R/proc " /proc/mounts || mount -t proc  proc  "$R/proc"  || die "gagal mount /proc"
  grep -q " $R/sys "  /proc/mounts || mount -t sysfs sysfs "$R/sys"   || die "gagal mount /sys"
  grep -q " $R/dev "  /proc/mounts || mount --bind /dev "$R/dev"      || die "gagal bind /dev"
  grep -q " $R/dev/pts " /proc/mounts || mount --bind /dev/pts "$R/dev/pts" 2>/dev/null || \
      mount -t devpts devpts "$R/dev/pts" 2>/dev/null || say "devpts tidak tersedia (bukan masalah untuk shell)"
  say "mount chroot siap"
}

umount_all() {
  for m in dev/pts dev sys proc; do
    umount "$R/$m" 2>/dev/null && say "umount $R/$m"
  done
  say "selesai"
}

# --- deteksi kemampuan namespace ---------------------------------------------
can_pidns() {
  command -v unshare >/dev/null 2>&1 || return 1
  unshare --help 2>&1 | grep -q -- '--pid' || return 1
  # uji nyata, bukan cuma lihat --help: sebagian kernel Android punya toybox unshare
  # tapi CONFIG_PID_NS dimatikan -> unshare gagal dengan EPERM/EINVAL.
  unshare --pid --fork true >/dev/null 2>&1
}

mode_shell() {
  say "masuk shell OpenWrt (chroot $R)"
  PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root TERM="${TERM:-xterm}" \
    exec chroot "$R" /bin/sh -l
}

mode_services() {
  say "menjalankan layanan inti tanpa procd (dnsmasq, dropbear, uhttpd)"
  # Tanpa procd tidak ada /etc/init.d/* start yang lengkap; jalankan langsung.
  # Konfigurasi tetap dibaca dari /etc/config (UCI), jadi  hasilnya sama dengan LuCI.
  #
  # PATH WAJIB diset di dalam chroot: chroot mewarisi PATH Android
  # (/product/bin:/system/bin:...) yang TIDAK memuat /bin//usr/bin rootfs, sehingga
  # busybox applet (hostname, netstat, sleep) "not found" padahal ada. Gejalanya
  # menyesatkan: seolah rootfs rusak, padahal hanya PATH.
  chroot "$R" /bin/sh -c '
    export PATH=/usr/sbin:/usr/bin:/sbin:/bin
    set -x
    # Hostkey dropbear tidak ada di tarball rootfs dan biasanya dibuat oleh
    # /etc/init.d/dropbear saat boot pertama (lewat procd). Tanpa itu dropbear keluar
    # seketika: "Early exit: No hostkeys available". Bikin di sini.
    if [ ! -f /etc/dropbear/dropbear_rsa_host_key ]; then
      mkdir -p /etc/dropbear
      /usr/sbin/dropbearkey -t rsa -s 2048 -f /etc/dropbear/dropbear_rsa_host_key >/dev/null 2>&1
      /usr/sbin/dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key >/dev/null 2>&1
    fi
    for s in dnsmasq dropbear uhttpd; do
      [ -x /usr/sbin/$s ] || [ -x /usr/sbin/$s ] || continue
      case "$s" in
        dnsmasq) /usr/sbin/dnsmasq -C /var/etc/dnsmasq.conf.cfg01411c 2>/dev/null || /usr/sbin/dnsmasq & ;;
        dropbear) /usr/sbin/dropbear -p 22 & ;;
        uhttpd)   /usr/sbin/uhttpd -f -h /www -r "$(hostname)" & ;;
      esac
    done
    sleep 2; netstat -ltn 2>/dev/null || ss -ltn 2>/dev/null
  '
}

mode_init() {
  can_pidns || {
    printf '[!] PID namespace tidak tersedia di kernel Android ini\n' >&2
    printf '[!] procd sebagai PID 1 tidak bisa dijalankan. Pakai --services atau --shell.\n' >&2
    exit 2
  }
  say "menjalankan procd (/sbin/init) di PID namespace baru"
  exec unshare --pid --fork --mount-proc="$R/proc" chroot "$R" /sbin/init
}

case "${1:-}" in
  --umount)   umount_all; exit 0 ;;
  --init)     mount_all; mode_init ;;
  --services) mount_all; mode_services ;;
  ""|--shell) mount_all; mode_shell ;;
  *) die "opsi tidak dikenal: $1" ;;
esac
