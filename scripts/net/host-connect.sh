#!/bin/sh
# host-connect.sh — siapkan SISI HOST setelah HP menancap lewat USB (RNDIS/ECM).
#
# Pakai:
#   ./scripts/net/host-connect.sh                 # deteksi otomatis + pasang IP
#   ./scripts/net/host-connect.sh --iface enx1234 --ip 192.168.42.2/24
#   ./scripts/net/host-connect.sh --check         # hanya memeriksa (tidak mengubah apa pun)
#   ./scripts/net/host-connect.sh --undo
#
# Kenapa skrip ini ada: kesalahan paling umum bukan "gadget tidak naik", tapi
# host yang mengirim trafik ke gateway rumahnya sendiri sehingga seolah "tidak nyambung".
# Skrip ini memasang IP di netdev USB TANPA default gateway (never-default), lalu MEMBUKTIKAN
# rutenya lewat `ip route get`.

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"

IFACE=""; IP="192.168.42.2/24"; PEER="192.168.42.1"; MODE=apply
while [ $# -gt 0 ]; do
  case "$1" in
    --iface) IFACE=$2; shift 2 ;;
    --ip)    IP=$2; shift 2 ;;
    --peer)  PEER=$2; shift 2 ;;
    --check) MODE=check ;;
    --undo)  MODE=undo ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done

need ip

detect_iface() {
  # netdev USB: enx<mac> (dari nama interface systemd/NM) atau usb0/rndis0
  for d in /sys/class/net/*; do
    n=$(basename "$d")
    case "$n" in
      enx*|usb*|rndis*) [ -e "$d/device" ] && { echo "$n"; return 0; } ;;
    esac
  done
  ip -o link show 2>/dev/null | awk -F': ' '$2 ~ /^(enx|usb|rndis)/ {print $2; exit}'
}

show_state() {
  echo "--- kondisi saat ini ---"
  ip -o addr show | awk '{print "  " $2 " " $4}' | sort
  echo "--- rute ke $PEER ---"
  ip route get "$PEER" 2>&1 | sed 's/^/  /'
}

case "$MODE" in
  check)
    IFACE=${IFACE:-$(detect_iface)}
    [ -n "${IFACE:-}" ] || die "tidak ada netdev USB — HP belum menancap atau gadget belum bind (cek: lsusb | grep 1d6b)"
    log "netdev USB: $IFACE"
    ip -4 addr show dev "$IFACE" | sed 's/^/  /'
    show_state
    ip route get "$PEER" | grep -q "dev $IFACE" \
      && ok "rute ke $PEER memang lewat $IFACE" \
      || die "rute ke $PEER TIDAK lewat $IFACE — trafik akan dikirim ke gateway lain (penyebab klasik 'ping gagal')"
    ping -c1 -W2 "$PEER" >/dev/null 2>&1 && ok "perangkat menjawab ping" || warn "tidak ada balasan ping dari $PEER"
    ;;

  undo)
    IFACE=${IFACE:-$(detect_iface)}
    [ -n "${IFACE:-}" ] || die "netdev USB tidak ditemukan"
    log "lepas IP dari $IFACE"
    ip addr del "$IP" dev "$IFACE" 2>/dev/null || true
    if have nmcli; then nmcli con delete "android-openwrt-$(echo "$IFACE" | tr -d ':')" 2>/dev/null || true; fi
    ok "selesai"
    ;;

  apply)
    # 1. apakah perangkat terlihat di USB? Patokan yang benar adalah vendor 1d6b (Linux Foundation),
    #    BUKAN VID Qualcomm/Xiaomi: gadget configfs (RNDIS) selalu memperkenalkan diri sebagai 1d6b.
    if ! (command -v lsusb >/dev/null && lsusb | grep -q '1d6b:'); then
      warn "lsusb tidak melihat perangkat 1d6b:* — gadget mungkin belum bind"
      warn "cari VID Qualcomm/Xiaomi (05c6/2717) adalah jebakan: RNDIS configfs = 1d6b"
    fi
    IFACE=${IFACE:-$(detect_iface)}
    [ -n "${IFACE:-}" ] || die "netdev USB belum ada. Tunggu gadget bind (paling lambat ~15 s setelah boot), lalu ulangi."

    log "netdev USB: $IFACE"

    if have nmcli; then
      CON="android-openwrt-$IFACE"
      nmcli con delete "$CON" >/dev/null 2>&1 || true
      nmcli con add type ethernet ifname "$IFACE" con-name "$CON" \
        ipv4.method manual ipv4.addresses "$IP" ipv4.never-default yes ipv6.method disabled >/dev/null
      nmcli con up "$CON" >/dev/null
      ok "NetworkManager: $CON ($IP, never-default yes) aktif"
    else
      ip addr flush dev "$IFACE" 2>/dev/null || true
      ip addr add "$IP" dev "$IFACE"
      ip link set "$IFACE" up
      ok "iproute2: $IP di $IFACE (tanpa default route)"
    fi

    show_state
    # 2. bukti rute
    ip route get "$PEER" | grep -q "dev $IFACE" \
      && ok "rute ke $PEER lewat $IFACE (benar)" \
      || warn "rute ke $PEER tidak lewat $IFACE — periksa apakah ada default gateway di interface ini"

    # 3. bukti hidup
    if ping -c1 -W2 "$PEER" >/dev/null 2>&1; then
      ok "ping $PEER balas"
      have ssh && log "lanjut: ssh root@$PEER"
    else
      warn "ping $PEER tidak balas. Urutan cek: gadget bind? IP perangkat terpasang? firewall OpenWrt?"
      warn "JANGAN simpulkan perangkat mati dari ping: ping bisa dijawab router rumah."
    fi
    ;;
esac
