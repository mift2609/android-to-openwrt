#!/usr/bin/env python3
"""mk-ipk-index.py — bikin berkas `Packages` (index repo opkg lokal) dari *.ipk.

Kenapa tidak memakai scripts/ipkg-make-index.sh bawaan OpenWrt: skrip itu menyusun
sed-expression dari isi control, dan gagal pada Description yang memuat karakter
pemisah ('/' atau '|'): "sed: -e expression #1, char 177: unknown option to `s'".
Versi ini membaca control langsung dengan tarfile dan menambahkan field yang wajib
untuk repo opkg: Filename, Size, SHA256sum.

Pakai: mk-ipk-index.py <dir-berisi-ipk>  > Packages
"""
import hashlib
import io
import os
import sys
import tarfile

MULTILINE = {"description", "conffiles"}


def read_control(ipk_path):
    with tarfile.open(ipk_path, "r:gz") as outer:
        member = next((m for m in outer.getmembers() if os.path.basename(m.name) == "control.tar.gz"), None)
        if member is None:
            return None
        blob = outer.extractfile(member).read()
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as inner:
        ctl = next((m for m in inner.getmembers() if os.path.basename(m.name) == "control"), None)
        if ctl is None:
            return None
        return inner.extractfile(ctl).read().decode("utf-8", "replace")


def emit(name, control, size, sha256):
    out = []
    for raw in control.splitlines():
        if not raw.strip():
            continue
        if raw[0] in " \t":                      # lanjutan field multiline
            if out:
                out[-1] += "\n" + raw
            continue
        key, _, val = raw.partition(":")
        if key.lower() in ("filename", "size", "sha256sum"):
            continue                              # diisi ulang di bawah
        out.append(f"{key}:{val}")
    out.append(f"Filename: {name}")
    out.append(f"Size: {size}")
    out.append(f"SHA256sum: {sha256}")
    return "\n".join(out)


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "."
    blocks = []
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".ipk"):
            continue
        path = os.path.join(d, fn)
        control = read_control(path)
        if control is None:
            print(f"[!] lewati {fn}: control tidak ditemukan", file=sys.stderr)
            continue
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        blocks.append(emit(fn, control, os.path.getsize(path), h.hexdigest()))
    sys.stdout.write("\n\n".join(blocks) + "\n")
    print(f"[i] index: {len(blocks)} paket", file=sys.stderr)


if __name__ == "__main__":
    main()