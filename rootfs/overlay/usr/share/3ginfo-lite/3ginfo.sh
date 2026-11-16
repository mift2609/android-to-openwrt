#!/bin/sh
# Pembungkus 3ginfo-lite untuk rolex.
#
# Skrip asli membaca modem lewat gcom/AT — di modem ini AT tidak menjawab sama sekali, dan
# skrip itu juga LAMBAT (puluhan detik menunggu AT) sehingga halaman LuCI "4G Connection"
# tampak kosong/nyangkut. Jadi untuk `json` kita tidak memanggilnya: nilai modem datang dari
# QMI (/usr/bin/rolex-3ginfo-json) dan statistik koneksi langsung dari kernel.
ORIG=/usr/share/3ginfo-lite/3ginfo.sh.orig
SINCE=/tmp/rolex-wwan0-since

human() {
	[ -n "$1" ] || { echo "-"; return; }
	awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f MiB", b/1048576; else if (b >= 1024) printf "%.1f KiB", b/1024; else printf "%d B", b }'
}

case "$1" in
json)
	# rx/tx: kernel tidak menghitung di wwan0, jadi baca penghitung iptables (chain ROLXSTAT
	# dibuat oleh /etc/init.d/rolex-nat).
	STAT=$(iptables -L ROLXSTAT -v -n 2>/dev/null)
	export rx=$(human "$(printf '%s\n' "$STAT" | awk '$3 == "RETURN" && $6 == "wwan0" { print $2; exit }')")
	export tx=$(human "$(printf '%s\n' "$STAT" | awk '$3 == "RETURN" && $7 == "wwan0" { print $2; exit }')")
	if ip -4 -o addr show wwan0 >/dev/null 2>&1; then export connt="LTE"; else export connt="-"; fi
	if [ -s "$SINCE" ]; then
		s=$(( $(cut -d. -f1 /proc/uptime) - $(cat "$SINCE" 2>/dev/null || echo 0) ))
		if [ "$s" -gt 0 ] 2>/dev/null; then
			export conn_time_sec="$s"
			export conn_time="$(awk -v t="$s" 'BEGIN { printf "%dd, %02d:%02d:%02d", int(t/86400), int(t/3600)%24, int(t/60)%60, t%60 }')"
		fi
	fi
	exec /usr/bin/rolex-3ginfo-json
	;;
*)
	exec $ORIG "$@"
	;;
esac
