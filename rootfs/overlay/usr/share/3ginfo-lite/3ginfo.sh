#!/bin/sh
# Pembungkus 3ginfo-lite untuk rolex.
#
# Skrip asli (3ginfo.sh.orig) membaca modem lewat gcom/AT. Di modem ini AT tidak menjawab dan
# skrip itu juga LAMBAT (puluhan detik menunggu AT) sehingga halaman LuCI tampak nyangkut.
# Jadi untuk `json` kita pakai /usr/bin/rolex-3ginfo-json (QMI, statistik dihitung sendiri).
#
# CATATAN: halaman LuCI 3ginfo-lite pada akhirnya tidak dipakai (menunya disembunyikan) karena
# halaman itu memanggil skrip ini dengan argumen string sehingga argumennya tak sampai ke sini.
# Info 4G sekarang ada di halaman Modem -> Modem LTE.
case "$1" in
json|"")
	exec /usr/bin/rolex-3ginfo-json
	;;
*)
	exec /usr/share/3ginfo-lite/3ginfo.sh.orig "$@"
	;;
esac
