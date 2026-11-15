#!/bin/sh
# Pembungkus 3ginfo-lite untuk rolex.
#
# Skrip aslinya membaca modem via gcom/AT. Di rolex port AT adalah char device
# WWAN (rpmsg_wwan_ctrl), bukan tty -> gcom/sms_tool gagal `tcsetattr: Bad file
# descriptor`, dan perintah berbau SIM dijawab `+CME ERROR: SIM busy` saat sesi
# data aktif. Jadi: nilai modem diambil dari QMI (lihat /usr/bin/rolex-3ginfo-json),
# sementara statistik koneksi (durasi, rx/tx) tetap dari skrip asli karena itu
# dibaca dari /proc/net/dev, bukan dari modem.
ORIG=/usr/share/3ginfo-lite/3ginfo.sh.orig
[ -x "$ORIG" ] || ORIG=/usr/share/3ginfo-lite/3ginfo.sh.orig

case "$1" in
json)
	base=$($ORIG json 2>/dev/null)
	pick() { printf '%s' "$base" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -1; }
	connt=$(pick connt)
	conn_time=$(pick conn_time)
	conn_time_sec=$(pick conn_time_sec)
	rx=$(pick rx)
	tx=$(pick tx)
	# suhu: pakai zona termal terpanas kalau ada
	mtemp=$(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1)
	[ -n "$mtemp" ] && mtemp=$(awk -v t="$mtemp" 'BEGIN{ printf "%.1f", t/1000 }')
	export connt conn_time conn_time_sec rx tx mtemp
	exec /usr/bin/rolex-3ginfo-json
	;;
*)
	exec $ORIG "$@"
	;;
esac
