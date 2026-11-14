#!/usr/bin/env python3
"""install-ipk-into-rootfs.py — pasang paket .ipk langsung ke pohon rootfs (tanpa opkg).

Konteks: LuCI yang dipin (commit lama openwrt-23.05) tidak bisa dipasang lewat ImageBuilder
karena paket di feed hari ini punya versi lebih tinggi, dan ImageBuilder menolak repo lokal
untuk paket meta ('luci', 'luci-ssl'). Jadi: image dirakit TANPA luci, lalu paket LuCI pin
diekstrak ke rootfs di sini, lengkap dengan pendaftaran di database opkg supaya
`opkg list-installed` / LuCI Software tidak melaporkan bohong.

Maintainer script TIDAK dijalankan di sini (host x86 tak bisa chroot ke aarch64). OpenWrt
sendiri menjalankan /etc/uci-defaults/* sekali saat boot pertama, jadi konfigurasi awal LuCI
tetap mendarat.

Pakai: install-ipk-into-rootfs.py <rootfs-dir> <file.ipk> [...]
"""
import io
import os
import sys
import tarfile
import time

INFO = "usr/lib/opkg/info"
STATUS = "usr/lib/opkg/status"


def open_control(ipk):
    with tarfile.open(ipk, "r:gz") as outer:
        m = next((x for x in outer.getmembers() if os.path.basename(x.name) == "control.tar.gz"), None)
        if m is None:
            return None, None
        blob = outer.extractfile(m).read()
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as inner:
        c = next((x for x in inner.getmembers() if os.path.basename(x.name) == "control"), None)
        if c is None:
            return None, None
        return blob, inner.extractfile(c).read().decode("utf-8", "replace")


def field(control, name):
    for line in control.splitlines():
        if line.lower().startswith(name.lower() + ":"):
            return line.split(":", 1)[1].strip()
    return ""


def install(root, ipk):
    ctl_blob, control = open_control(ipk)
    if control is None:
        print(f"[!] {os.path.basename(ipk)}: control tidak ditemukan", file=sys.stderr)
        return False
    pkg = field(control, "Package")

    # 1. ekstrak data.tar.gz
    with tarfile.open(ipk, "r:gz") as outer:
        m = next((x for x in outer.getmembers() if os.path.basename(x.name) == "data.tar.gz"), None)
        if m is None:
            print(f"[!] {pkg}: data.tar.gz tidak ada", file=sys.stderr)
            return False
        data = outer.extractfile(m).read()

    files = []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as inner:
        for member in inner.getmembers():
            inner.extract(member, root, filter="data") if hasattr(tarfile, "data_filter") else inner.extract(member, root)
            name = member.name.lstrip("./")
            if name and not member.isdir():
                files.append("/" + name)

    # 2. daftarkan di database opkg
    infodir = os.path.join(root, INFO)
    os.makedirs(infodir, exist_ok=True)
    entry = (f"Package: {pkg}\n" + "\n".join(l for l in control.splitlines() if not l.startswith("Package:")) +
             "\nStatus: install user installed\n")
    if not field(control, "Installed-Time"):
        entry += f"Installed-Time: {int(time.time())}\n"
    with open(os.path.join(infodir, pkg + ".control"), "w") as f:
        f.write(entry)
    with open(os.path.join(infodir, pkg + ".list"), "w") as f:
        f.write("\n".join(files) + "\n")
    os.makedirs(os.path.dirname(os.path.join(root, STATUS)), exist_ok=True)
    status_path = os.path.join(root, STATUS)
    # Buang entri lama dengan nama paket sama: ImageBuilder bisa sudah memasang versi feed
    # (mis. luci-base git-25.222) sebagai dependensi, dan dua entri untuk satu paket membuat
    # opkg/LuCI melaporkan versi yang salah walau berkas di disk sudah versi pin.
    blocks = []
    if os.path.exists(status_path):
        with open(status_path) as f:
            for block in f.read().split("\n\n"):
                if block.strip() and not block.lstrip().startswith(f"Package: {pkg}\n"):
                    blocks.append(block.rstrip("\n"))
    blocks.append(entry.rstrip("\n"))
    with open(status_path, "w") as f:
        f.write("\n\n".join(blocks) + "\n")
    print(f"  [ok] {pkg} ({len(files)} berkas)")
    return True


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    root = sys.argv[1]
    ok = 0
    for ipk in sys.argv[2:]:
        if install(root, ipk):
            ok += 1
    print(f"[i] terpasang: {ok} paket")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())