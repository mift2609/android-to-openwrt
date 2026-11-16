#!/bin/sh
# Ganti nama "BFR" -> "OpenWrt" pada bundel frontend BFR (dist/), tanpa mengubah kode.
# Dijalankan sekali setiap kali dist/ diperbarui dari sumber BFR.
set -e
cd "$(dirname "$0")/dist"

for f in index.html assets/*.js; do
	[ -f "$f" ] || continue
	sed -i \
		-e 's/BFR WEBUI/OPENWRT/g' \
		-e 's/BFR Control Panel/OpenWrt Control Panel/g' \
		-e 's/Android Root Control Panel/Panel Kendali OpenWrt/g' \
		-e 's/Android Version/Versi Sistem/g' \
		-e 's/BFR/OpenWrt/g' \
		-e 's/Android Device/Perangkat/g' \
		"$f"
done

grep -o "<title>[^<]*</title>" index.html
echo "sisa 'BFR': $(grep -ro 'BFR' . | wc -l)  sisa 'Android': $(grep -ro 'Android' . | wc -l)"