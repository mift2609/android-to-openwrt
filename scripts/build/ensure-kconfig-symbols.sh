#!/bin/sh
# ensure-kconfig-symbols.sh <kernel-tree>
#
# Tujuan: menambal entri Kconfig yang HILANG di pohon fork, padahal Makefile-nya sudah
# memakai simbol itu. Tanpa ini, driver tak akan pernah bisa dibangun walau fragment
# perangkat memintanya — dan `apply-config-fragment.sh` justru GAGAL karena simbolnya
# tidak dikenal Kconfig (perilaku yang memang diinginkan: jangan diam-diam diabaikan).
#
# Kasus nyata (msm89x7-mainline/linux v7.1.3-r1):
#   drivers/pinctrl/qcom/Makefile : obj-$(CONFIG_PINCTRL_MSM8917) += pinctrl-msm8917.o
#   drivers/pinctrl/qcom/Kconfig  : tidak ada `config PINCTRL_MSM8917` sama sekali
# Akibat di perangkat (terbukti di rolex lewat probe initramfs):
#   - pinctrl@1000000 di DTB rolex ber-compatible "qcom,msm8917-pinctrl", tidak ada
#     driver yang cocok ("qcom,msm8916-pinctrl" saja yang terdaftar di pinctrl-msm8916)
#   - semua periferal dengan `pinctrl-0` menggantung: /dev/mmcblk* KOSONG (eMMC tak probe),
#     `devices_deferred` memuat i2c yang menunggu supplier pinctrl@1000000
#
# Idempoten: kalau simbolnya sudah ada, tidak mengubah apa pun.

set -eu
TREE=${1:?pemakaian: ensure-kconfig-symbols.sh <kernel-tree>}
KC="$TREE/drivers/pinctrl/qcom/Kconfig"

if [ ! -f "$KC" ]; then
  echo "[x] Kconfig tidak ditemukan: $KC" >&2
  exit 1
fi

if grep -q '^config PINCTRL_MSM8917$' "$KC"; then
  echo "[ok] PINCTRL_MSM8917 sudah ada di drivers/pinctrl/qcom/Kconfig"
  exit 0
fi

# Sisipkan tepat setelah `if (ARCH_QCOM || COMPILE_TEST)` supaya tetap di dalam blok SoC Qualcomm.
sed -i '/^if (ARCH_QCOM || COMPILE_TEST)$/a\
\
config PINCTRL_MSM8917\
\ttristate "Qualcomm MSM8917 pin controller driver"\
\tdepends on OF\
\tselect PINCTRL_MSM' "$KC"

grep -q '^config PINCTRL_MSM8917$' "$KC" || { echo "[x] gagal menyisipkan PINCTRL_MSM8917" >&2; exit 1; }
echo "[ok] PINCTRL_MSM8917 disisipkan ke drivers/pinctrl/qcom/Kconfig (simbol hilang di fork)"
sed -n '/^config PINCTRL_MSM8917$/,/^$/p' "$KC"
