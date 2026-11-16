#!/bin/sh
# Pasang ulang paket rolex setelah flash image baru.
#   ./tools/reinstall-packages.sh [host]
# Membaca devices/rolex/packages.txt, lalu di perangkat: opkg update + opkg install
# untuk paket yang belum ada. Paket bertanda [HG] (dari image HG680P) tidak ada di feed;
# skrip akan melaporkannya agar dipasang lewat tools/port-from-image.py.
set -u
HOST=${1:-192.168.42.1}
LIST="$(dirname "$0")/../devices/rolex/packages.txt"
[ -f "$LIST" ] || { echo "daftar paket tidak ada: $LIST"; exit 1; }

grep -v '^#' "$LIST" | grep -v '^$' > /tmp/rolex-pkgs.txt
echo "=== kirim daftar ke $HOST ==="
cat /tmp/rolex-pkgs.txt | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$HOST" 'cat > /tmp/rolex-pkgs.txt'

echo "=== pasang di perangkat ==="
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$HOST" 'sh -s' <<'EOS'
opkg update >/dev/null 2>&1
missing=""
n=0
while read -r p; do
	[ -n "$p" ] || continue
	if opkg list-installed 2>/dev/null | grep -q "^$p - "; then continue; fi
	n=$((n + 1))
	if opkg install "$p" >/tmp/opkg-one.log 2>&1; then
		echo "  ok   $p"
	else
		echo "  GAGAL $p"
		missing="$missing $p"
	fi
done < /tmp/rolex-pkgs.txt
echo "--- dicoba: $n paket"
[ -n "$missing" ] && echo "--- masih kurang:$missing"
echo "--- catatan: paket asal image HG680P (nikki, tailscale, luci-app-nikki, luci-app-tailscale-community,"
echo "    dnsmasq-full, curl, yq, ip-full) tidak ada di feed aarch64_generic;"
echo "    pasang dengan tools/port-from-image.py dari image HG680P (lihat docs/rolex-fitur-port.md)."
EOS
