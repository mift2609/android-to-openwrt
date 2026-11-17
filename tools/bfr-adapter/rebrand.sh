#!/bin/sh
# Sesuaikan teks frontend BFR untuk OpenWrt, tanpa mengubah kode:
#  - nama "BFR" / "WEBUI-GO" -> OpenWrt
#  - istilah Android/Magisk yang muncul di halaman login & shell -> OpenWrt
#  - label tombol login -> Bahasa Indonesia
# Tautan repo asli dipertahankan (atribusi GPL-3).
set -e
cd "$(dirname "$0")/dist"

FILES="index.html assets/*.js"
for f in $FILES; do
	[ -f "$f" ] || continue
	# halaman About = kredit pembuat asli: JANGAN diubah
	case "$f" in *TabAbout-*) continue ;; esac
	sed -i \
		-e 's/BFR WEBUI/OPENWRT/g' \
		-e 's/BFR Control Panel/OpenWrt Control Panel/g' \
		-e 's/Android Root Control Panel/Panel Kendali OpenWrt/g' \
		-e 's/Android Root System Control/Panel Kendali OpenWrt/g' \
		-e 's/Magisk \/ KernelSU \/ APatch Module/rolex \&bull; MSM8917 \&bull; OpenWrt/g' \
		-e 's/KernelSU \/ APatch Module/OpenWrt/g' \
		-e 's/WEBUI-GO/OpenWrt/g' \
		-e 's/ • Android / • OpenWrt /g' \
		-e 's/Standard Android/OpenWrt 24.10.5/g' \
		-e 's/Android Version/Versi Sistem/g' \
		-e 's/Android Device/Perangkat/g' \
		-e 's/Magisk \/ Root module index/Indeks modul sistem/g' \
		-e 's/Custom Password Active/Sandi aktif/g' \
		-e 's/Enter access password/Masukkan kata sandi panel/g' \
		-e 's/Quick Access/Akses cepat/g' \
		-e 's/Access Password/Kata Sandi/g' \
		-e 's/ACCESS PASSWORD/KATA SANDI/g' \
		-e 's/Sign In/Masuk/g' \
		-e 's/APPEARANCE/TAMPILAN/g' \
		-e 's/Appearance Studio/Studio Tampilan/g' \
		-e 's/Appearance/Tampilan/g' \
		-e 's/Connect & Community/Sumber \& Komunitas/g' \
		-e 's/CONNECT & COMMUNITY/SUMBER \& KOMUNITAS/g' \
		-e 's/SIGN IN/MASUK/g' \
		-e 's/Toggle password visibility/Tampilkan sandi/g' \
		-e 's/>B<\/div>/>O<\/div>/g' \
		-e 's/BFR/OpenWrt/g' \
		"$f"
done

# footer: "OpenWrt &bull; rolex &bull; MSM8917 &bull; OpenWrt" -> tanpa ekor
sed -i \
	-e 's/OpenWrt-OpenWrt &bull; rolex &bull; MSM8917 &bull; OpenWrt/OpenWrt \&bull; rolex \&bull; MSM8917/g' \
	-e 's/OpenWrt &bull; rolex &bull; MSM8917 &bull; OpenWrt/OpenWrt \&bull; rolex \&bull; MSM8917/g' \
	-e 's/OpenWrt-OpenWrt/OpenWrt/g' \
	index.html assets/*.js 2>/dev/null || true

# tautan repo asli dikembalikan agar tidak 404 (atribusi)
sed -i 's#latifangren/OpenWrt#latifangren/BFR-WEBUI-GO#g' index.html assets/*.js 2>/dev/null || true


# suntikkan penyesuaian tampilan (sembunyikan baris kosong, buang kata "Android")
cp ../ui/fix.js fix.js
cp ../ui/modem-page.js modem-page.js   # halaman Cellular: ganti isi bawaan dengan kartu sendiri
if ! grep -q 'src="/fix.js"' index.html; then
	sed -i 's#</body>#<script src="/fix.js"></script></body>#' index.html
fi
if ! grep -q 'src="/modem-page.js"' index.html; then
	sed -i 's#</body>#<script src="/modem-page.js"></script></body>#' index.html
fi

python3 ../prune-tabs.py . || echo "(prune gagal, lanjut)"

echo "judul      : $(grep -o '<title>[^<]*</title>' index.html)"
echo "sisa BFR   : $(grep -oh 'BFR' index.html assets/*.js | wc -l) (hanya tautan repo)"
echo "Android/js : $(grep -o 'Android' assets/index-*.js | wc -l)"
echo "Magisk/js  : $(grep -o 'Magisk' assets/index-*.js | wc -l)"