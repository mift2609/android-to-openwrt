#!/bin/sh
# new-device.sh — buat profil perangkat baru untuk HP Qualcomm apa pun, dengan VERIFIKASI.
#
# Pakai:
#   ./scripts/devices/new-device.sh --name rolex --soc msm8917 --codename rolex
#   ./scripts/devices/new-device.sh --soc msm8953 --list      # lihat keluarga SoC yang didukung
#   ./scripts/devices/new-device.sh --check-socs              # verifikasi seluruh tabel SoC ke GitHub
#
# Apa yang diverifikasi (bukan tebakan):
#   1. keluarga SoC ada di socs/qualcomm-soc-family.conf  -> repo kernel + lk2nd yang benar
#   2. repo kernel itu benar-benar ada dan branch/tag-nya ada (GitHub API)
#   3. DTB untuk codename perangkat benar-benar ada di repo itu (dicari di arch/arm64/boot/dts/qcom
#      berdasarkan nama codename) -> nama DTB yang dipakai `build-kernel.sh`
#
# Apa yang TIDAK bisa diverifikasi dari jarak jauh (dan karena itu ditulis sebagai TODO):
#   argumen mkbootimg, nama partisi, dan offset lk2nd. Ketiganya HARUS dibaca dari perangkat
#   yang bersangkutan — salah satu saja salah, boot image-nya tidak dikenali bootloader.
#   Jalankan scripts/devices/probe-device.sh saat perangkat sudah tersambung.

set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/scripts/lib/common.sh"

NAME=""; SOC=""; CODENAME=""; LIST=0; CHECK_SOCS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name)       NAME=$2; shift 2 ;;
    --soc)        SOC=$2; shift 2 ;;
    --codename)   CODENAME=$2; shift 2 ;;
    --list)       LIST=1; shift ;;
    --check-socs) CHECK_SOCS=1; shift ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done

TABLE="$(repo_root)/socs/qualcomm-soc-family.conf"
[ -f "$TABLE" ] || die "tabel SoC tidak ada: $TABLE"

# --- fungsi GitHub API: pakai gh kalau ada (kuota lebih besar), kalau tidak curl ------------
api() {  # api <path>  -> JSON ke stdout
  if have gh && gh auth status >/dev/null 2>&1; then gh api "$1"
  else curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/$1"; fi
}
json_field() { python3 -c 'import json,sys; d=json.load(sys.stdin);
v=d
for k in sys.argv[1].split("."):
    v = v.get(k) if isinstance(v, dict) else v
print(v if v is not None else "")' "$1"; }

list_socs() {
  printf '%-12s %-44s %-18s %s\n' "SoC" "repo kernel (mainline)" "branch/tag" "device contoh"
  grep -v '^[[:space:]]*#' "$TABLE" | grep -v '^[[:space:]]*$' | while IFS="$(printf '\t')" read -r soc repo ref lk2nd note; do
    printf '%-12s %-44s %-18s %s\n' "$soc" "${repo#https://github.com/}" "$ref" "$note"
  done
}

if [ "$LIST" = 1 ]; then list_socs; exit 0; fi

# --- verifikasi seluruh tabel -------------------------------------------------
if [ "$CHECK_SOCS" = 1 ]; then
  log "verifikasi tabel SoC ke GitHub (repo, ref, lk2nd)"
  bad=0
  grep -v '^[[:space:]]*#' "$TABLE" | grep -v '^[[:space:]]*$' | while IFS="$(printf '\t')" read -r soc repo ref lk2nd note; do
    slug=${repo#https://github.com/}
    branch=$(api "repos/$slug" 2>/dev/null | json_field default_branch || echo "")
    is_tag=$(api "repos/$slug/git/ref/tags/$ref" >/dev/null 2>&1 && echo tag || echo "")
    is_branch=$([ "$branch" = "$ref" ] && echo branch || echo "")
    lk_slug=${lk2nd#https://github.com/}
    lk=$(api "repos/$lk_slug" >/dev/null 2>&1 && echo ok || echo MISSING)
    if [ -n "$branch" ] && { [ -n "$is_tag" ] || [ -n "$is_branch" ]; } && [ "$lk" = ok ]; then
      printf '  [ok] %-10s %-30s ref=%s\n' "$soc" "$slug" "$ref"
    else
      printf '  [X]  %-10s %-30s ref=%s (branch=%s tag=%s lk2nd=%s)\n' "$soc" "$slug" "$ref" "$branch" "$is_tag" "$lk"
    fi
  done
  exit 0
fi

[ -n "$SOC" ] || die "--soc wajib (mis. --soc msm8917). Lihat daftar: --list"
[ -n "$CODENAME" ] || die "--codename wajib (nama perangkat di kernel, mis. rolex)"
[ -n "$NAME" ] || NAME=$CODENAME

# --- 1. keluarga SoC ---------------------------------------------------------
ROW=$(grep -v '^[[:space:]]*#' "$TABLE" | awk -F'\t' -v s="$SOC" '$1==s{print; exit}')
if [ -z "$ROW" ]; then
  warn "SoC '$SOC' tidak ada di tabel. Cari keluarga terdekat:"
  list_socs | head -20
  die "tambahkan dulu keluarga SoC-nya ke $TABLE (atau pakai --soc yang ada di daftar)"
fi
KREPO=$(printf '%s' "$ROW" | cut -f2)
KREF=$(printf '%s' "$ROW"  | cut -f3)
LKREPO=$(printf '%s' "$ROW" | cut -f4)
ok "keluarga SoC: $SOC -> $(printf '%s' "$KREPO" | sed 's#https://github.com/##') @ $KREF"

SLUG=${KREPO#https://github.com/}

# --- 2. repo kernel ada? -----------------------------------------------------
DBRANCH=$(api "repos/$SLUG" 2>/dev/null | json_field default_branch || echo "")
[ -n "$DBRANCH" ] || die "repo kernel tidak terjangkau: $KREPO (cek jaringan/token gh)"
ok "repo kernel ada (default branch: $DBRANCH)"

# --- 3. tag/branch yang dipakai ada? ----------------------------------------
if api "repos/$SLUG/git/ref/tags/$KREF" >/dev/null 2>&1; then
  ok "tag $KREF ada"
elif [ "$DBRANCH" = "$KREF" ]; then
  ok "ref $KREF adalah default branch"
  warn "repo ini berbasis branch (tanpa tag) — nilai KERNEL_TAG di device.conf akan berisi nama branch; build tetap jalan karena tarball branch juga bisa diunduh"
else
  warn "tag '$KREF' TIDAK ada di $SLUG. Tag terbaru:"
  api "repos/$SLUG/tags" 2>/dev/null | python3 -c 'import json,sys
try:
    print("  " + ", ".join(t["name"] for t in json.load(sys.stdin)[:8]))
except Exception:
    print("  (tidak bisa membaca daftar tag)")'
  die "pilih tag yang benar lalu ulangi (--soc tidak menerima tag; sunting tabel SoC kalau perlu)"
fi

# --- 4. DTB untuk codename ini ada? -----------------------------------------
log "cari DTB '$CODENAME' di $SLUG/arch/$([ "$SOC" = msm8226 ] && echo arm || echo arm64)/boot/dts/qcom"
ARCHDIR=arm64
case "$SOC" in msm8226|msm8909|msm8916|msm8939) ARCHDIR=arm64 ;; esac
DTS_LIST=$(api "repos/$SLUG/contents/arch/$ARCHDIR/boot/dts/qcom?ref=$( [ "$DBRANCH" = "$KREF" ] && echo "$DBRANCH" || echo "$KREF" )" 2>/dev/null \
  | python3 -c 'import json,sys
try:
    print("\n".join(e["name"] for e in json.load(sys.stdin) if e["name"].endswith(".dts")))
except Exception:
    pass') || true

[ -n "$DTS_LIST" ] || die "tidak bisa membaca daftar DTS di $SLUG (rate limit? repo privat? ref salah?)"
DTS=$(printf '%s\n' "$DTS_LIST" | grep -i -- "$CODENAME" | head -1 || true)
if [ -z "$DTS" ]; then
  warn "tidak ada DTS yang memuat '$CODENAME'. Kandidat yang mengandung kata mirip:"
  printf '%s\n' "$DTS_LIST" | grep -iE "$(printf '%s' "$CODENAME" | cut -c1-4)" | head -10 | sed 's/^/    /'
  die "perangkat ini mungkin belum ada DTS-nya di kernel mainline. Port DTS dulu (lihat docs/07) atau pakai codename yang benar."
fi
DTB_PATH="qcom/${DTS%.dts}.dtb"
ok "DTB ditemukan: $DTS -> $DTB_PATH"

if printf '%s' "$DTS_LIST" | grep -qi -- "$CODENAME" ; then :; fi
MAKEFILE_HAS=$(api "repos/$SLUG/contents/arch/$ARCHDIR/boot/dts/qcom/Makefile?ref=$DBRANCH" 2>/dev/null \
  | python3 -c 'import json,sys,base64
try:
    print(base64.b64decode(json.load(sys.stdin)["content"]).decode())
except Exception:
    pass' || true)
if [ -n "$MAKEFILE_HAS" ]; then
  if printf '%s' "$MAKEFILE_HAS" | grep -q -- "${DTS%.dts}.dtb"; then
    ok "DTB terdaftar di Makefile (akan dibangun oleh target 'dtbs')"
  else
    warn "DTB ada sebagai .dts tapi TIDAK terdaftar di Makefile — 'make dtbs' tidak akan menghasilkannya."
    warn "Tambahkan sendiri: dtb-\$(CONFIG_ARCH_QCOM) += ${DTS%.dts}.dtb  (lihat docs/07)"
  fi
fi

# --- 5. tulis profil ---------------------------------------------------------
DIR="$(repo_root)/devices/$NAME"
[ -e "$DIR" ] && die "profil sudah ada: $DIR (hapus dulu kalau memang mau ditimpa)"
mkdir -p "$DIR"

cat > "$DIR/device.conf" <<EOF
# Profil perangkat: $NAME (dibuat oleh scripts/devices/new-device.sh)
# Nilai bertanda TODO HARUS diisi dari perangkat nyata (scripts/devices/probe-device.sh).

DEVICE_NAME="$NAME (belum diisi — nama pasaran perangkat)"
SOC="$SOC"
ARCH="arm64"
CROSS_COMPILE="aarch64-linux-gnu-"

# --- jalur B: kernel (terverifikasi ada di GitHub) ---------------------------
KERNEL_REPO="$KREPO"
KERNEL_TAG="$KREF"
KERNEL_CONFIG_FRAGMENT="devices/$NAME/kernel.config.fragment"
DTB="$DTB_PATH"

# TODO: WAJIB diukur di perangkat. Jangan mengira-ngira: ambil dari boot image stok
# dengan  ./scripts/devices/probe-device.sh --device $NAME --boot-img <stok-boot.img>
MKBOOTIMG_ARGS=""     # contoh: --base 0x80000000 --kernel_offset 0x00008000 --ramdisk_offset 0x01000000 --tags_offset 0x00000100 --pagesize 2048 --header_version 0
KERNEL_CMDLINE=""     # contoh: console=tty0 console=ttyMSM0,115200n8 earlycon panic=5

# TODO: partisi. Pakai nama, bukan nomor (nomor beda antar-varian).
BOOT_PARTITION="/dev/block/bootdevice/by-name/boot"
USERDATA_PARTITION="/dev/block/bootdevice/by-name/userdata"
# 512 = lk2nd tinggal di dalam partisi boot; 0 = bootloader stok aboot, DTB di-append.
# UKUR, jangan asumsikan: lihat docs/04 bagian "di mana image ini harus ditulis".
LK2ND_OFFSET_KIB=512

# --- jaringan ----------------------------------------------------------------
GADGET_IP="192.168.42.1/24"
HOST_IP="192.168.42.2/24"
HOST_MAC="02:1a:11:00:42:01"
DEVICE_MAC="02:1a:11:00:42:02"
AP_SSID="$NAME-hotspot"
AP_PASSPHRASE=""

# --- jalur A (chroot) --------------------------------------------------------
CHROOT_DIR="/data/local/openwrt"
OPENWRT_RELEASE="24.10.5"
OPENWRT_ROOTFS_ARCH="arm64"
EOF

# fragment: kerangka + opsi yang wajib untuk perangkat apa pun (USB/gadget/netfilter/DRM)
cat > "$DIR/kernel.config.fragment" <<EOF
# Fragment config kernel untuk $NAME ($SOC) — kerangka dari new-device.sh.
# Opsi di sini = syarat minimum agar perangkat bisa jadi router:
# USB gadget jalan dari initramfs, nftables ada untuk firewall4, layar punya console.
# Verifikasi penerapannya: ./scripts/build/apply-config-fragment.sh --tree <kernel> --fragment \$ini
# TODO: sesuaikan bagian clock/interconnect dengan SoC-mu (lihat tabel Kconfig driver).

# VA 48-bit eksplisit: choice di arch/arm64/Kconfig default-nya 52-bit, dan core ARMv8.0
# (Cortex-A53) tidak mendukungnya -> reboot di awal boot tanpa log.
CONFIG_ARM64_VA_BITS_48=y
# CONFIG_ARM64_VA_BITS_52 is not set

# USB gadget (RNDIS/ECM) — harus built-in, initramfs tidak memuat modul
CONFIG_PHY_QCOM_QUSB2=y
CONFIG_USB_GADGET=y
CONFIG_USB_CONFIGFS=y
CONFIG_USB_CONFIGFS_RNDIS=y
CONFIG_USB_F_RNDIS=y
CONFIG_USB_LIBCOMPOSITE=y
CONFIG_USB_U_ETHER=y
CONFIG_USB_DWC3=y
CONFIG_USB_DWC3_QCOM=y

# netfilter/nftables (firewall4) + routing
CONFIG_NETFILTER=y
CONFIG_NF_TABLES=y
CONFIG_NF_TABLES_INET=y
CONFIG_NF_NAT=y
CONFIG_NF_CONNTRACK=y
CONFIG_NETFILTER_XTABLES=y
CONFIG_BRIDGE=y
CONFIG_VETH=y
CONFIG_TUN=y

# filesystem rootfs
CONFIG_EXT4_FS=y
CONFIG_F2FS_FS=y
CONFIG_SQUASHFS=y
CONFIG_OVERLAY_FS=y
CONFIG_DEVTMPFS=y
CONFIG_DEVTMPFS_MOUNT=y

# console di layar (kalau tidak ada, kegagalan boot tak bisa dibedakan dari mati)
CONFIG_DRM=y
CONFIG_DRM_KMS_HELPER=y
CONFIG_DRM_SIMPLEDRM=y
CONFIG_FRAMEBUFFER_CONSOLE=y

# TODO: clock + interconnect SoC. Contoh msm8953: CONFIG_MSM_GCC_8953=y +
# CONFIG_INTERCONNECT_QCOM_MSM8953=y. Untuk keluarga msm89x7, driver GCC-nya MSM_GCC_8916.
EOF

cat > "$DIR/README.md" <<EOF
# $NAME ($SOC) — profil BARU, belum terbukti

Status: **kerangka**. Yang sudah diverifikasi hanya yang bisa dibaca dari GitHub:
repo kernel \`$(printf '%s' "$KREPO" | sed 's#https://github.com/##')\`, ref \`$KREF\`, dan DTB \`$DTB_PATH\`.

## Checklist sebelum menulis apa pun ke perangkat

1. [ ] \`./scripts/devices/probe-device.sh --device $NAME --boot-img <boot-stok.img>\` — isi MKBOOTIMG_ARGS,
       KERNEL_CMDLINE, nama partisi, dan LK2ND_OFFSET_KIB di \`device.conf\` dari hasil ukur ini.
2. [ ] Backup partisi stok (\`boot\`, \`recovery\`, \`modem\`, \`persist\`, \`fsg\`, \`modemst1/2\`) + catat md5 — lihat docs/04.
3. [ ] Pasang \`lk2nd\` (${LKREPO#https://github.com/}) — di banyak perangkat Qualcomm ini WAJIB:
       tanpa lk2nd, kernel mainline tidak memilih panel/lk2nd tidak memberikan DTB yang cocok.
4. [ ] Build: \`gh workflow run build-kernel.yml -f device=$NAME\` atau \`make DEVICE=$NAME kernel initramfs bootimg\`.
5. [ ] Uji tanpa menulis: \`fastboot boot out/$NAME/boot.img\`.
6. [ ] Baru tulis: \`fastboot flash boot out/$NAME/boot.img\` (dan rootfs ke partisi data).
7. [ ] Verifikasi pasca-boot: \`uname -r\`, \`df -h /\`, IP gadget, SSH, LuCI, dan (kalau ada) WiFi + uplink.

## Yang pasti masih perlu dikerjakan (perangkat baru selalu begini)

- DTS di kernel mainline jarang lengkap untuk WiFi/modem: periksa \`/lib/firmware\` untuk
  \`wcnss.*\` + \`WCNSS_qcom_wlan_nv.bin\` dan node remoteproc di DTS.
- Kalau DTS belum ada sama sekali: \`new-device.sh\` akan menolak dan menyebut perangkat ini
  belum didukung. Menulis DTS baru = kerja port, bukan sekadar menambah profil (docs/07).
EOF

ok "profil dibuat: $DIR"
echo
log "langkah berikutnya:"
printf '  1) sambungkan perangkat, jalankan: ./scripts/devices/probe-device.sh --device %s --boot-img <boot-stok.img>\n' "$NAME"
printf '  2) lengkapi TODO di devices/%s/device.conf dari hasil probe itu\n' "$NAME"
printf '  3) build: make DEVICE=%s kernel initramfs bootimg\n' "$NAME"
