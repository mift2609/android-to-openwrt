import re, sys
p = sys.argv[1]
s = open(p).read()

new_load = '''load_modules() {
	# Catatan: modul ini harus urut qcom_q6v5 -> q6v5_mss. `find` + insmod pernah gagal senyap
	# saat boot (argumen kosong -> "failed to insert (null)"), jadi pakai glob path eksplisit
	# dan verifikasi lewat munculnya /sys/class/remoteproc/remoteproc1.
	K=/lib/modules/$(uname -r)
	_try=0
	while [ $_try -lt 10 ]; do
		modprobe -a qcom_q6v5 qcom_q6v5_mss qcom_bam_dmux rpmsg_wwan_ctrl 2>/dev/null
		[ -d /sys/class/remoteproc/remoteproc1 ] || {
			for ko in $K/kernel/drivers/remoteproc/qcom_q6v5.ko \\
				  $K/kernel/drivers/remoteproc/qcom_q6v5_mss.ko \\
				  $K/kernel/drivers/net/wwan/qcom_bam_dmux.ko \\
				  $K/kernel/drivers/net/wwan/rpmsg_wwan_ctrl.ko; do
				[ -f "$ko" ] && { insmod "$ko" >/dev/null 2>&1; }
			done
		}
		[ -d /sys/class/remoteproc/remoteproc1 ] && return 0
		_try=$((_try+1))
		sleep 2
	done
	logger -t rolex-modem "modul MSS gagal dimuat setelah $_try percobaan"
	return 1
}
'''

m = re.search(r'load_modules\(\) \{.*?\n\}\n', s, re.S)
if not m:
    sys.exit("load_modules tidak ditemukan")
s = s[:m.start()] + new_load + s[m.end():]
open(p, 'w').write(s)
print("patched v2")